// ================== 全域設定 ==================
const CONFIG = {
  MAX_WIDTH: 1024,
  JPEG_QUALITY: 0.75,
  MIN_QUALITY: 0.5,
  RETRY_COUNT: 3,
  RETRY_DELAY_BASE: 500,
  MAX_CONCURRENT_UPLOADS: 5,
  COMPRESSION_TIMEOUT: 8000,
  // ⚠️ 請確認此處為您的 Cloudflare Worker 網址
  API_ENDPOINT: 'https://fire-management-api.firework202511.workers.dev'
};

// 全域變數：儲存資料
let GLOBAL_ORG_DATA = {};       // 組別-課別 對照表
let GLOBAL_LOCATION_MAP = {};   // 公司-工程-地點 對照表 (新增)

// ================== 表單配置 ==================
const FORM_CONFIGS = {
  pre: {
    formId: 'preForm',
    loadingId: 'preFormLoading',
    apiPath: '/api/submit-pre',
    photos: [
      { inputId: 'prePhoto1', statusId: 'prePhoto1Status' },
      { inputId: 'prePhoto2', statusId: 'prePhoto2Status' }
    ],
    statusIds: ['prePhoto1Status', 'prePhoto2Status', 'preFormMsg'],
    getPayload: () => {
        // 1. 抓取複選框 (動火項目)
        const checkedBoxes = document.querySelectorAll('input[name="fireItem"]:checked');
        const selectedItems = Array.from(checkedBoxes).map(cb => cb.value).join(', ');
        
        if (!selectedItems) {
            throw new Error('請至少勾選一項動火項目');
        }

        // 2. 抓取主辦部門 (組-課)
        const group = getFieldValue('preGroup');
        const section = getFieldValue('preSection');
        
        // 檢查是否選擇了組與課
        if (!group || !section) {
            throw new Error('請完整選擇主辦單位 (組與課)');
        }

        return {
          company: getFieldValue('preCompany'),
          inputCompany: getFieldValue('preInputCompany'),
          project: getFieldValue('preProject'),
          inputProject: getFieldValue('preInputProject'),
          uploader: getFieldValue('preUploader'), // 上傳者姓名
          department: `${group}-${section}`,      // 組合字串 (組-課)
          startTime: getFieldValue('preStartTime'),
          endTime: getFieldValue('preEndTime'),
          area: getFieldValue('preArea'),
          location: getFieldValue('preLocation'),
          restricted: getFieldValue('preRestricted'),
          items: selectedItems // 複選結果
        };
    }
  },
  during: {
    formId: 'duringForm',
    loadingId: 'duringFormLoading',
    apiPath: '/api/submit-during',
    photos: [
      { inputId: 'duringPhoto1', statusId: 'duringPhoto1Status' },
      { inputId: 'duringPhoto2', statusId: 'duringPhoto2Status' }
    ],
    statusIds: ['duringPhoto1Status', 'duringPhoto2Status', 'duringFormMsg'],
    getPayload: () => ({
      company: getFieldValue('duringCompany'),
      project: getFieldValue('duringProject'),
      location: getFieldValue('duringLocation'), // 新增：抓取動火地點
      q1: getFieldValue('q1')
    })
  },
  after: {
    formId: 'afterForm',
    loadingId: 'afterFormLoading',
    apiPath: '/api/submit-after',
    photos: [
      { inputId: 'afterPhoto1', statusId: 'afterPhoto1Status' },
      { inputId: 'afterPhoto2', statusId: 'afterPhoto2Status' }
    ],
    statusIds: ['afterPhoto1Status', 'afterPhoto2Status', 'afterFormMsg'],
    getPayload: () => ({
      company: getFieldValue('afterCompany'),
      project: getFieldValue('afterProject'),
      location: getFieldValue('afterLocation'), // 新增：抓取動火地點
      qTime: getFieldValue('qTime'),
      qYesNo: getFieldValue('qYesNo')
    })
  }
};

// ================== 上傳隊列管理器 ==================
class UploadQueue {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.queue = [];
  }

  async add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) return;
    
    this.running++;
    const { task, resolve, reject } = this.queue.shift();
    
    try {
      const result = await task();
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      this.running--;
      this.process();
    }
  }
}

const uploadQueue = new UploadQueue(CONFIG.MAX_CONCURRENT_UPLOADS);

// ================== 初始化與下拉選單邏輯 ==================
async function initApp() {
  try {
    const response = await fetch(`${CONFIG.API_ENDPOINT}/api/dropdown-data`);
    if (!response.ok) throw new Error('API 回應錯誤');
    
    const data = await response.json();
    
    if (data.error) {
      console.error('API 錯誤:', data.details);
      alert('無法載入選單，請稍後再試');
      return;
    }

    initDropdowns(data);

    // 設定預設查詢日期為今天
    const today = new Date().toISOString().split('T')[0];
    const queryDateEl = document.getElementById('queryDate');
    if (queryDateEl) queryDateEl.value = today;
  } catch (err) {
    console.error('初始化失敗:', err);
    // 這裡不跳出 alert 避免干擾，但會在 console 顯示錯誤
  }
}

// ================== 修改後的 initDropdowns 與連動邏輯 ==================
function initDropdowns(data) {
  const { companies, areas, items, orgData, locationMap } = data;
  
  GLOBAL_ORG_DATA = orgData || {};
  GLOBAL_LOCATION_MAP = locationMap || {}; // 接收後端傳來的地點資料表

  // 1. 公司選單
  ['preCompany', 'duringCompany', 'afterCompany', 'queryCompany'].forEach(id => {
    fillSelect(id, Object.keys(companies));
  });
  
  // 2. 組別與區域選單
  fillSelect('preGroup', Object.keys(GLOBAL_ORG_DATA));
  fillSelect('preArea', areas);
  
  // 3. 填入動火項目 (Checkbox 邏輯保持不變)
  // ... (省略部分代碼) ...

  // 4. 設定所有下拉選單的連動邏輯
  setupCascadingDropdowns(companies);
}

function setupCascadingDropdowns(companies) {
  const configs = [
    { company: 'preCompany', project: 'preProject', location: null }, 
    { company: 'duringCompany', project: 'duringProject', location: 'duringLocation' },
    { company: 'afterCompany', project: 'afterProject', location: 'afterLocation' }
  ];

  configs.forEach(({ company, project, location }) => {
    const companyEl = document.getElementById(company);
    const projectEl = document.getElementById(project);
    const locationEl = location ? document.getElementById(location) : null;

    if (!companyEl || !projectEl) return;

    // 公司變動更新工程
    companyEl.addEventListener('change', () => {
      const selectedCompany = companyEl.value;
      const projects = companies[selectedCompany] || [];
      fillSelect(project, projects);
      if (locationEl) fillSelect(location, []); 
    });

    // 核心修復：工程變動更新地點選單
    if (locationEl) {
      projectEl.addEventListener('change', () => {
        const selectedCompany = companyEl.value;
        const selectedProject = projectEl.value;
        
        let locations = [];
        if (GLOBAL_LOCATION_MAP[selectedCompany] && GLOBAL_LOCATION_MAP[selectedCompany][selectedProject]) {
          locations = GLOBAL_LOCATION_MAP[selectedCompany][selectedProject];
        }

        fillSelect(location, locations);
        if (locations.length === 0) {
           locationEl.innerHTML = '<option value="">無相符的動火地點 (請檢查動火前紀錄)</option>';
        }
      });
    }
  });
}

  // 6. 設定所有下拉選單的連動邏輯 (公司->工程->地點)
  setupCascadingDropdowns(companies);
}

function fillSelect(id, options) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '<option value="">請選擇</option>';
  if(options) {
      options.forEach(opt => el.add(new Option(opt, opt)));
  }
  // 只有非查詢、非組別、非課別、非地點選單才加「其他」
  // (注意：duringLocation 和 afterLocation 是從 Map 產生的，不需要其他)
  const noOtherIds = ['queryCompany', 'preGroup', 'preSection', 'duringLocation', 'afterLocation'];
  if (!noOtherIds.includes(id)) {
    el.add(new Option('其他', '其他'));
  }
}

// 主辦部門連動邏輯 (組 -> 課) - 用於 HTML onchange
function onGroupChange() {
  const group = document.getElementById('preGroup').value;
  // 從全域變數抓取該組底下的課
  const sections = GLOBAL_ORG_DATA[group] || [];
  
  // 更新 "課別" 選單
  const sectionSelect = document.getElementById('preSection');
  if (sectionSelect) {
      sectionSelect.innerHTML = '<option value="">請選擇課別</option>';
      sections.forEach(sec => {
          sectionSelect.add(new Option(sec, sec));
      });
  }
}

// 設定多層級連動 (公司 -> 工程 -> 地點)
function setupCascadingDropdowns(companies) {
  const configs = [
    // 動火前：公司 -> 工程 (無地點連動，地點為手選區域)
    { company: 'preCompany', project: 'preProject', location: null }, 
    // 動火中：公司 -> 工程 -> 地點
    { company: 'duringCompany', project: 'duringProject', location: 'duringLocation' },
    // 動火後：公司 -> 工程 -> 地點
    { company: 'afterCompany', project: 'afterProject', location: 'afterLocation' }
  ];

  configs.forEach(({ company, project, location }) => {
    const companyEl = document.getElementById(company);
    const projectEl = document.getElementById(project);
    const locationEl = location ? document.getElementById(location) : null;

    if (!companyEl || !projectEl) return;

    // 1. 公司改變 -> 更新工程
    companyEl.addEventListener('change', () => {
      const selectedCompany = companyEl.value;
      const projects = companies[selectedCompany] || [];
      
      fillSelect(project, projects); // 更新工程選單
      
      // 若有地點選單，則在更換公司時清空地點
      if (locationEl) {
        fillSelect(location, []); 
        locationEl.innerHTML = '<option value="">請先選擇工程</option>';
      }
    });

    // 2. 工程改變 -> 更新地點 (僅針對動火中/後)
    if (locationEl) {
      projectEl.addEventListener('change', () => {
        const selectedCompany = companyEl.value;
        const selectedProject = projectEl.value;
        
        // 從 GLOBAL_LOCATION_MAP 查找對應的地點清單
        let locations = [];
        if (GLOBAL_LOCATION_MAP[selectedCompany] && 
            GLOBAL_LOCATION_MAP[selectedCompany][selectedProject]) {
          locations = GLOBAL_LOCATION_MAP[selectedCompany][selectedProject];
        }

        fillSelect(location, locations);
        
        if (locations.length === 0) {
           locationEl.innerHTML = '<option value="">無相符的動火地點</option>';
        }
      });
    }
  });
}

// ================== 工具函式與圖片處理 ==================
function getFieldValue(id) {
  return document.getElementById(id)?.value || '';
}

function updateStatus(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function calculateDimensions(width, height, maxWidth) {
  const scale = Math.min(1, maxWidth / width);
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    scale
  };
}

// 漸進式壓縮
async function resizeImageProgressive(file, quality = CONFIG.JPEG_QUALITY) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('壓縮超時'));
    }, CONFIG.COMPRESSION_TIMEOUT);

    const reader = new FileReader();
    
    reader.onload = e => {
      const img = new Image();
      
      img.onload = () => {
        try {
          const { width, height } = calculateDimensions(
            img.width, 
            img.height, 
            CONFIG.MAX_WIDTH
          );
          
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d', { 
            alpha: false,
            willReadFrequently: false 
          });
          
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'medium';
          ctx.drawImage(img, 0, 0, width, height);
          
          clearTimeout(timeout);
          resolve({
            dataUrl: canvas.toDataURL('image/jpeg', quality),
            mime: 'image/jpeg',
            quality,
            filename: file.name
          });
        } catch (err) {
          clearTimeout(timeout);
          reject(err);
        }
      };
      
      img.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('無法載入圖片'));
      };
      
      img.src = e.target.result;
    };
    
    reader.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('讀取檔案錯誤'));
    };
    
    reader.readAsDataURL(file);
  });
}

// 智能重試上傳
async function uploadWithSmartRetry(file, statusId) {
  let quality = CONFIG.JPEG_QUALITY;
  for (let attempt = 1; attempt <= CONFIG.RETRY_COUNT; attempt++) {
    try {
      updateStatus(statusId, `${attempt > 1 ? '重試' : '處理'}中 (${Math.round(quality * 100)}%)...`);
      const { dataUrl, mime, filename } = await resizeImageProgressive(file, quality);
      const result = await uploadQueue.add(() => 
        uploadToServer(dataUrl, mime, filename, statusId, attempt)
      );
      if (result?.success) {
        updateStatus(statusId, '✅ 成功');
        return result.url;
      }
      
      throw new Error(result?.error || '上傳失敗');
    } catch (err) {
      console.warn(`上傳嘗試 ${attempt} 失敗:`, err.message);
      if (attempt === CONFIG.RETRY_COUNT) {
        updateStatus(statusId, '❌ 失敗');
        throw new Error(`上傳失敗（已重試 ${CONFIG.RETRY_COUNT} 次）`);
      }
      
      quality = Math.max(CONFIG.MIN_QUALITY, quality - 0.1);
      await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY_BASE * Math.pow(1.5, attempt - 1)));
    }
  }
}

// 上傳到伺服器 (Cloudflare Worker)
async function uploadToServer(dataUrl, mime, filename, statusId, attempt) {
  const startTime = Date.now();
  try {
    const response = await fetch(`${CONFIG.API_ENDPOINT}/api/upload-photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl, mime, filename })
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`上傳成功 (${duration}s):`, filename);
    
    return result;
  } catch (err) {
    console.error(`上傳失敗 (嘗試 ${attempt}):`, err);
    throw err;
  }
}

// 批量處理照片
async function batchProcessPhotos(photos) {
  const results = [];
  for (const photo of photos) {
    const input = document.getElementById(photo.inputId);
    if (!input?.files?.length) {
      results.push(null);
      continue;
    }
    
    try {
      const url = await uploadWithSmartRetry(input.files[0], photo.statusId);
      results.push(url);
    } catch (err) {
      console.error(`照片處理失敗 (${photo.inputId}):`, err);
      throw err;
    }
  }
  
  return results;
}

// ================== 表單提交邏輯 ==================
function setupFormSubmit(config) {
  const form = document.getElementById(config.formId);
  if (!form) return;
  
  const loadingEl = document.getElementById(config.loadingId);
  const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    
    if (loadingEl) loadingEl.style.display = 'inline-block';
    setSubmitButtonState(submitBtn, true);
    
    const startTime = Date.now();
    
    try {
      const photoUrls = await batchProcessPhotos(config.photos);
      
      const payload = config.getPayload();
      payload.photoUrls = photoUrls;
      
      await submitToBackend(config.apiPath, payload);
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`表單提交成功，耗時 ${duration} 秒`);
      
      handleSubmitSuccess(form, config.statusIds);
      
    } catch (err) {
      handleSubmitError(err);
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
      setSubmitButtonState(submitBtn, false);
    }
  });
}

function setSubmitButtonState(btn, isSubmitting) {
  if (!btn) return;
  btn.disabled = isSubmitting;
  btn.textContent = isSubmitting ? '送出中...' : '送出';
}

async function submitToBackend(apiPath, payload) {
  const response = await fetch(`${CONFIG.API_ENDPOINT}${apiPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '提交失敗');
  }
  
  return response.json();
}

function handleSubmitSuccess(form, statusIds) {
  form.reset();
  statusIds.forEach(id => updateStatus(id, ''));
  alert('✅ 送出成功！');
}

function handleSubmitError(err) {
  console.error('提交失敗:', err);
  alert('❌ 送出失敗：' + (err.message || '未知錯誤'));
}

// ================== 查詢功能 ==================
async function searchRecords() {
  const date = val('queryDate');
  const company = val('queryCompany');
  const div = document.getElementById('queryResults');
  document.getElementById('queryLoading').style.display = 'block'; div.innerHTML = '';
  
  try {
    const url = new URL(`${CONFIG.API_ENDPOINT}/api/search-records`);
    url.searchParams.append('date', date);
    if(company) url.searchParams.append('company', company);
    
    const res = await fetch(url);
    const json = await res.json();
    if(!json.data || json.data.length === 0) { div.innerHTML = '<div style="text-align:center;padding:20px">查無資料</div>'; return; }

    let html = `<table class="result-table"><thead><tr><th>時機</th><th>公司</th><th>工程</th><th>時間</th><th>地點</th><th>照片1</th><th>照片2</th></tr></thead><tbody>`;
    json.data.forEach(Row => {
      const badge = Row.type==='動火前'?'badge-pre':(Row.type==='動火中'?'badge-during':'badge-after');
      const p1 = Row.photo1 ? `<a href="${Row.photo1}" target="_blank" class="photo-icon" title="預覽">📷</a>` : '-';
      const p2 = Row.photo2 ? `<a href="${Row.photo2}" target="_blank" class="photo-icon" title="預覽">📷</a>` : '-';
      html += `<tr>
        <td data-label="時機"><span class="badge ${badge}">${Row.type}</span></td>
        <td data-label="公司">${Row.company}</td>
        <td data-label="工程">${Row.project}</td>
        <td data-label="時間">${Row.time.split(' ')[1]} ${Row.time.split(' ')[2]}</td>
        <td data-label="地點">${Row.location}</td>
        <td data-label="照片1">${p1}</td>
        <td data-label="照片2">${p2}</td>
      </tr>`;
    });
    div.innerHTML = html + '</tbody></table>';
  } catch(e) { console.error(e); alert('查詢錯誤'); }
  finally { document.getElementById('queryLoading').style.display = 'none';
  }
}

function val(id) { return document.getElementById(id)?.value || ''; }

// ================== 初始化執行 ==================
// 綁定所有表單提交事件
Object.values(FORM_CONFIGS).forEach(setupFormSubmit);

// 頁面載入時初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

