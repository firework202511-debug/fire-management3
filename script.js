// 全域設定
const CONFIG = {
  MAX_WIDTH: 1024, JPEG_QUALITY: 0.75, API_ENDPOINT: 'https://fire-management-api.firework202511.workers.dev' // ⚠️ 請確認網址
};

const FORM_CONFIGS = {
  pre: {
    formId: 'preForm', loadingId: 'preFormLoading', apiPath: '/api/submit-pre',
    photos: [{id:'prePhoto1',s:'prePhoto1Status'}, {id:'prePhoto2',s:'prePhoto2Status'}],
    getPayload: () => ({
      company: val('preCompany'), inputCompany: val('preInputCompany'),
      project: val('preProject'), inputProject: val('preInputProject'),
      manager: val('preManager'), // [新增]
      department: val('preDepartment'), startTime: val('preStartTime'), endTime: val('preEndTime'),
      area: val('preArea'), location: val('preLocation'), restricted: val('preRestricted'), items: val('preItems')
    })
  },
  during: {
    formId: 'duringForm', loadingId: 'duringFormLoading', apiPath: '/api/submit-during',
    photos: [{id:'duringPhoto1',s:'duringPhoto1Status'}, {id:'duringPhoto2',s:'duringPhoto2Status'}],
    getPayload: () => ({ company: val('duringCompany'), project: val('duringProject'), q1: val('q1') })
  },
  after: {
    formId: 'afterForm', loadingId: 'afterFormLoading', apiPath: '/api/submit-after',
    photos: [{id:'afterPhoto1',s:'afterPhoto1Status'}, {id:'afterPhoto2',s:'afterPhoto2Status'}],
    getPayload: () => ({ company: val('afterCompany'), project: val('afterProject'), qTime: val('qTime'), qYesNo: val('qYesNo') })
  }
};

// ================== 初始化 ==================
async function initApp() {
  try {
    const response = await fetch(`${CONFIG.API_ENDPOINT}/api/dropdown-data`);
    if (!response.ok) throw new Error('載入失敗');
    
    const data = await response.json();
    initDropdowns(data);
    
    // 設定預設查詢日期為今天
    const today = new Date().toISOString().split('T')[0];
    const queryDateEl = document.getElementById('queryDate');
    if (queryDateEl) queryDateEl.value = today;

  } catch (err) {
    console.error('初始化失敗:', err);
    alert('載入下拉選單失敗，請重新整理頁面');
  }
}

function initDropdowns(data) {
  const { companies, areas, items } = data;
  
  // 填入所有表單的公司選單，包含查詢表單
  ['preCompany', 'duringCompany', 'afterCompany', 'queryCompany'].forEach(id => {
    fillSelect(id, Object.keys(companies));
  });
  
  fillSelect('preArea', areas);
  fillSelect('preItems', items);
  
  setupCompanyProjectLinks(companies);
}

function fillSelect(id, options) {
  const el = document.getElementById(id);
  if (!el) return;
  
  // 保留第一項 "請選擇"
  el.innerHTML = '<option value="">請選擇</option>';
  options.forEach(opt => el.add(new Option(opt, opt)));
  
  // 查詢表單不需要「其他」選項
  if (id !== 'queryCompany') {
    el.add(new Option('其他', '其他'));
  }
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



// [修改] 查詢功能：顯示照片圖示
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
  finally { document.getElementById('queryLoading').style.display = 'none'; }
}

function val(id) { return document.getElementById(id)?.value || ''; }

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', initApp); else initApp();
