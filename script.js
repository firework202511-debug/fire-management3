//================== 全域設定 ==================
const CONFIG = {
  MAX_WIDTH: 1024,
  JPEG_QUALITY: 0.75,
  MIN_QUALITY: 0.5,
  RETRY_COUNT: 3,
  RETRY_DELAY_BASE: 500,
  MAX_CONCURRENT_UPLOADS: 5,
  COMPRESSION_TIMEOUT: 8000,
  // ⚠️ 重要：改成你的 Worker 網址
  API_ENDPOINT: 'https://fire-management-api.firework202511.workers.dev'
};

// 表單配置
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
    // [新增] 必填驗證邏輯
    validate: () => {
      const checked = document.querySelectorAll('#preItemsContainer input:checked');
      if (checked.length === 0) {
        alert('請至少選擇一個動火項目！');
        return false;
      }
      return true;
    },
    getPayload: () => ({
      company: getFieldValue('preCompany'),
      inputCompany: getFieldValue('preInputCompany'),
      project: getFieldValue('preProject'),
      inputProject: getFieldValue('preInputProject'),
      uploader: getFieldValue('preUploader'),
      // 將組別與課別合併
      department: getFieldValue('preGroup') + ' ' + getFieldValue('preSection'),
      startTime: getFieldValue('preStartTime'),
      endTime: getFieldValue('preEndTime'),
      area: getFieldValue('preArea'),
      location: getFieldValue('preLocation'),
      restricted: getFieldValue('preRestricted'),
      // [修改] 抓取 checkbox 的值並合併
      items: Array.from(document.querySelectorAll('#preItemsContainer input:checked'))
              .map(cb => cb.value).join('、')
    })
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
      location: getFieldValue('duringLocation'), 
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
      location: getFieldValue('afterLocation'),
      qTime: getFieldValue('qTime'),
      qYesNo: getFieldValue('qYesNo')
    })
  }
};

// 上傳隊列管理器
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

// ================== 初始化 ==================
async function initApp() {
  try {
    const response = await fetch(`${CONFIG.API_ENDPOINT}/api/dropdown-data`);
    if (!response.ok) throw new Error('載入失敗');
    
    const data = await response.json();
    initDropdowns(data);
    const today = new Date().toISOString().split('T')[0];
    const queryDateEl = document.getElementById('queryDate');
    if (queryDateEl) queryDateEl.value = today;
  } catch (err) {
    console.error('初始化失敗:', err);
    alert('載入下拉選單失敗，請重新整理頁面');
  }
}

function initDropdowns(data) {
  const { companies, areas, items, groups } = data;
  
  ['preCompany', 'duringCompany', 'afterCompany', 'queryCompany'].forEach(id => {
    fillSelect(id, Object.keys(companies));
  });
  
  fillSelect('preArea', areas);
  
  // [修改] 改用 fillCheckboxGroup 填入動火項目
  fillCheckboxGroup('preItemsContainer', items);
  
  if (groups) {
    fillSelect('preGroup', Object.keys(groups));
    setupGroupSectionLinks(groups);
  }

  setupCompanyProjectLinks(companies);
  setupLocationFetcher();
}

function fillSelect(id, options) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '<option value="">請選擇</option>';
  options.forEach(opt => el.add(new Option(opt, opt)));
  if (id !== 'queryCompany' && id !== 'preGroup' && id !== 'preSection') {
    el.add(new Option('其他', '其他'));
  }
}

// [新增] 產生 Checkbox 群組
function fillCheckboxGroup(containerId, options) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = ''; // 清空載入中文字
  
  if (!options || options.length === 0) {
    container.innerHTML = '<div style="color:#888; grid-column: 1/-1;">無可用項目 (請檢查 Sheet 資料)</div>';
    return;
  }

  options.forEach(opt => {
    const label = document.createElement('label');
    label.className = 'checkbox-label';
    
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = opt;
    input.name = 'preItemsCheckbox'; // 方便辨識
    
    label.appendChild(input);
    label.appendChild(document.createTextNode(opt));
    container.appendChild(label);
  });
}

function setupCompanyProjectLinks(companies) {
  const pairs = [
    { company: 'preCompany', project: 'preProject' },
    { company: 'duringCompany', project: 'duringProject' },
    { company: 'afterCompany', project: 'afterProject' }
  ];
  pairs.forEach(({ company, project }) => {
    const companyEl = document.getElementById(company);
    if (!companyEl) return;
    
    companyEl.addEventListener('change', () => {
      const projects = companies[companyEl.value] || [];
      fillSelect(project, projects);
    });
  });
}

function setupGroupSectionLinks(groups) {
    const groupEl = document.getElementById('preGroup');
    const sectionEl = document.getElementById('preSection');
    
    if(!groupEl || !sectionEl) return;
    groupEl.addEventListener('change', () => {
        const selectedGroup = groupEl.value;
        const sections = groups[selectedGroup] || [];
        sectionEl.innerHTML = '<option value="">請選擇</option>';
        sections.forEach(sec => {
            sectionEl.add(new Option(sec, sec));
        });
    });
}

function setupLocationFetcher() {
  const configs = [
    { companyId: 'duringCompany', projectId: 'duringProject', locationId: 'duringLocation' },
    { companyId: 'afterCompany', projectId: 'afterProject', locationId: 'afterLocation' }
  ];
  configs.forEach(({ companyId, projectId, locationId }) => {
    const projectEl = document.getElementById(projectId);
    const companyEl = document.getElementById(companyId);
    
    projectEl.addEventListener('change', async () => {
      const company = companyEl.value;
      const project = projectEl.value;
      const locationEl = document.getElementById(locationId);
      
      if (!company || !project) {
        locationEl.innerHTML = '<option value="">請先選擇公司與工程</option>';
        return;
      }

      locationEl.innerHTML = '<option value="">搜尋中...</option>';
      locationEl.disabled = true;

      try {
        const url = new URL(`${CONFIG.API_ENDPOINT}/api/get-today-locations`);
        url.searchParams.append('company', company);
        url.searchParams.append('project', project);

        const res = await fetch(url);
        const data = await res.json();
        
        locationEl.innerHTML = '<option value="">請選擇地點</option>';
        if (data.locations && data.locations.length > 0) {
          data.locations.forEach(loc => {
            locationEl.add(new Option(loc, loc));
          });
        } else {
          locationEl.add(new Option('查無今日動火前紀錄', ''));
        }
      } catch (err) {
        console.error('地點載入失敗', err);
        locationEl.innerHTML = '<option value="">載入失敗</option>';
      } finally {
        locationEl.disabled = false;
      }
    });
  });
}

// ================== 工具函式 ==================
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
          const { width, height } = calculateDimensions(img.width, img.height, CONFIG.MAX_WIDTH);
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
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
      img.onerror = () => { clearTimeout(timeout); reject(new Error('無法載入圖片')); };
      img.src = e.target.result;
    };
    reader.onerror = () => { clearTimeout(timeout); reject(new Error('讀取檔案錯誤')); };
    reader.readAsDataURL(file);
  });
}

async function uploadWithSmartRetry(file, statusId) {
  let quality = CONFIG.JPEG_QUALITY;
  for (let attempt = 1; attempt <= CONFIG.RETRY_COUNT; attempt++) {
    try {
      updateStatus(statusId, `${attempt > 1 ? '重試' : '處理'}中 (${Math.round(quality * 100)}%)...`);
      const { dataUrl, mime, filename } = await resizeImageProgressive(file, quality);
      const result = await uploadQueue.add(() => uploadToServer(dataUrl, mime, filename, statusId, attempt));
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
    
    // [新增] 執行自定義驗證
    if (config.validate && !config.validate()) {
      return;
    }
    
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

// ================== 後台管理邏輯 ==================
let isAdmin = false;

function adminLogin() {
  const acc = document.getElementById('adminAcc').value;
  const pwd = document.getElementById('adminPwd').value;
  if (acc === 'admin' && pwd === 'safe1234') {
    isAdmin = true;
    document.getElementById('loginFormUI').style.display = 'none';
    document.getElementById('adminStatusUI').style.display = 'flex';
    document.getElementById('adminAcc').value = ''; document.getElementById('adminPwd').value = '';
    alert('登入成功！已解鎖刪除功能。');
    if (document.getElementById('queryResults').innerHTML !== '') searchRecords();
  } else { alert('帳號或密碼錯誤！'); }
}

function adminLogout() {
  isAdmin = false;
  document.getElementById('loginFormUI').style.display = 'flex';
  document.getElementById('adminStatusUI').style.display = 'none';
  alert('已登出管理員模式。');
  if (document.getElementById('queryResults').innerHTML !== '') searchRecords();
}

async function deleteRecord(sheetType, rowIndex) {
  if (!confirm('⚠️ 警告：確定要刪除這筆紀錄嗎？這將會清除雲端資料庫中的資料，且無法復原！')) return;
  try {
    const res = await fetch(`${CONFIG.API_ENDPOINT}/api/admin/delete-record`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetType, rowIndex })
    });
    if (!res.ok) throw new Error('刪除失敗');
    alert('✅ 資料已成功刪除');
    searchRecords(); 
  } catch (err) { alert('❌ 刪除發生錯誤: ' + err.message); }
}

// ================== 查詢邏輯 ==================
// ================== 查詢邏輯 ==================
async function searchRecords() {
  const date = val('queryDate');
  const company = val('queryCompany');
  const div = document.getElementById('queryResults');
  
  // 驗證邏輯：兩者不能同時為空
  if (!date && !company) {
    alert('請至少輸入「查詢日期」或選擇「公司名稱」');
    return;
  }

  document.getElementById('queryLoading').style.display = 'block'; 
  div.innerHTML = '';
  
  try {
    const url = new URL(`${CONFIG.API_ENDPOINT}/api/search-records`);
    // 只有當參數有值時才 append
    if (date) url.searchParams.append('date', date);
    if (company) url.searchParams.append('company', company);
    
    const res = await fetch(url);
    const json = await res.json();
    
    if (json.error) { throw new Error(json.error); } 

    if(!json.data || json.data.length === 0) { 
        div.innerHTML = '<div style="text-align:center;padding:20px">查無資料</div>'; 
        return; 
    }

    // 判斷如果是管理員，表頭增加「操作」欄位
    let tableHead = `<tr><th>時機</th><th>公司</th><th>工程</th><th>主辦姓名</th><th>時間</th><th>地點</th><th>照片1</th><th>照片2</th>`;
    if (isAdmin) tableHead += `<th>操作 (管理員)</th>`;
    tableHead += `</tr>`;
    
    let html = `<table class="result-table"><thead>${tableHead}</thead><tbody>`;
    
    json.data.forEach(Row => {
      const badge = Row.type==='動火前'?'badge-pre':(Row.type==='動火中'?'badge-during':'badge-after');
      const p1 = Row.photo1 ? `<a href="${Row.photo1}" target="_blank" class="photo-icon" title="預覽">📷</a>` : '-';
      const p2 = Row.photo2 ? `<a href="${Row.photo2}" target="_blank" class="photo-icon" title="預覽">📷</a>` : '-';
      
      // ✅ 這裡修復了遺失的括號與結尾標籤
      let adminActions = '';
      if (isAdmin) {
        adminActions = `<td data-label="操作">
          <button onclick="deleteRecord('${Row.sheetType}', ${Row.rowIndex})" style="background:#e53e3e; color:white; padding:4px 8px; border:none; border-radius:4px; font-weight:bold; cursor:pointer; font-size:0.9em; width:100%;">刪除</button>
        </td>`;
      }

      // ✅ 這裡補回了 ${adminActions} 讓刪除按鈕顯示出來
      html += `<tr>
        <td data-label="時機"><span class="badge ${badge}">${Row.type}</span></td>
        <td data-label="公司">${Row.company}</td>
        <td data-label="工程">${Row.project}</td>
        <td data-label="主辦姓名">${Row.uploader}</td>
        <td data-label="時間">${Row.time.split(' ')[0]}<br>${Row.time.split(' ')[1]} ${Row.time.split(' ')[2]}</td>
        <td data-label="地點">${Row.location}</td>
        <td data-label="照片1">${p1}</td>
        <td data-label="照片2">${p2}</td>
        ${adminActions}
      </tr>`;
    });
    div.innerHTML = html + '</tbody></table>';
  } catch(e) { 
    console.error(e); 
    div.innerHTML = `<div style="text-align:center;color:red;padding:20px">查詢錯誤: ${e.message}</div>`;
  }
  finally { 
    document.getElementById('queryLoading').style.display = 'none';
  }
}

function val(id) { return document.getElementById(id)?.value || ''; }
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

Object.values(FORM_CONFIGS).forEach(setupFormSubmit);




