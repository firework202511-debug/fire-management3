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

    // ✅ 注入「未完成動火提醒」UI
    injectIncompleteReminderUI();
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
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheetType, rowIndex })
    });
    
    const data = await res.json(); // 取得後端詳細的回傳資訊
    
    if (!res.ok) {
        // 如果失敗，拋出後端寫明的具體錯誤原因
        throw new Error(data.error || '未知錯誤');
    }
    
    alert('✅ 資料已成功刪除');
    searchRecords(); 
  } catch (err) { 
    alert('❌ 刪除發生錯誤: ' + err.message); 
  }
}

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

// ================== 未完成動火提醒 UI ==================

/**
 * 在查詢區塊頂部注入「未完成動火提醒」按鈕與面板。
 * 掛載點：queryDate 輸入框所在的父容器（預設找 #queryDate 往上兩層）。
 */
function injectIncompleteReminderUI() {
  // 避免重複注入
  if (document.getElementById('incompletePanel')) return;

  // ── CSS ──
  const style = document.createElement('style');
  style.textContent = `
    #incompleteBtn {
      display:inline-flex; align-items:center; gap:6px;
      padding:7px 14px; border-radius:6px; font-size:.82rem; font-weight:600;
      font-family:inherit; cursor:pointer; border:none;
      background:#b45309; color:#fff; transition:background .15s;
    }
    #incompleteBtn:hover { background:#9a4508; }
    #incReminderRow {
      display:flex; align-items:flex-end; gap:8px; flex-wrap:wrap;
      margin-bottom:12px; padding:0 4px;
    }
    #incDateWrap { display:flex; flex-direction:column; gap:4px; }
    #incDateWrap label { font-size:.72rem; font-weight:600; color:#8e97aa; }
    #incDate {
      padding:6px 10px; border:1.5px solid #dde1ea; border-radius:6px;
      font-size:.82rem; font-family:inherit; color:#141820;
      background:#fff; outline:none; width:160px;
    }
    #incDate:focus { border-color:#3664c8; }
    #incompletePanel {
      display:none; margin-top:18px;
      background:#fff; border:1px solid #b45309; border-radius:16px;
      overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,.08);
    }
    #incompletePanel.show { display:block; }
    .inc-ap-hd {
      background:#fffbeb; padding:14px 20px;
      display:flex; align-items:center; gap:10px;
      border-bottom:1px solid #b45309;
    }
    .inc-ap-hd h3 { font-size:.9rem; font-weight:700; color:#b45309; margin:0; }
    .inc-ap-hd p  { font-size:.73rem; color:#b45309; margin:2px 0 0; opacity:.85; }
    .inc-ap-hd .close-btn {
      margin-left:auto; padding:4px 10px; border-radius:6px; font-size:.76rem;
      font-weight:600; font-family:inherit; cursor:pointer;
      border:1.5px solid #dde1ea; background:transparent; color:#4b5465;
    }
    .inc-ap-hd .close-btn:hover { background:#f0f2f6; }
    #incompleteBd { padding:16px 20px; }
    .incomplete-item {
      display:flex; align-items:flex-start; gap:12px;
      padding:10px 14px; border-radius:8px; margin-bottom:8px;
      background:#f0f2f6; border:1px solid #dde1ea;
    }
    .incomplete-item:last-of-type { margin-bottom:0; }
    .inc-ico  { font-size:1.1rem; flex-shrink:0; margin-top:2px; }
    .inc-body { flex:1; }
    .inc-co   { font-size:.86rem; font-weight:700; color:#141820; }
    .inc-prj  { font-size:.75rem; color:#4b5465; margin-top:2px; }
    .inc-tags { display:flex; gap:6px; margin-top:6px; flex-wrap:wrap; }
    .inc-tag  { font-size:.66rem; font-weight:700; padding:2px 8px; border-radius:20px; }
    .inc-tag.ok   { background:#ebfaf4; color:#0f7b5a; }
    .inc-tag.miss { background:#fdf2f1; color:#c0392b; }
  `;
  document.head.appendChild(style);

  // ── 按鈕列 ──
  const row = document.createElement('div');
  row.id = 'incReminderRow';
  row.innerHTML = `
    <div id="incDateWrap">
      <label>查詢日期（空白＝今日）</label>
      <input type="date" id="incDate">
    </div>
    <button id="incompleteBtn" onclick="checkIncomplete()">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      </svg>
      未完成動火提醒
    </button>
  `;

  // ── 結果面板 ──
  const panel = document.createElement('div');
  panel.id = 'incompletePanel';
  panel.innerHTML = `
    <div class="inc-ap-hd">
      <svg width="18" height="18" fill="none" stroke="#b45309" stroke-width="2" viewBox="0 0 24 24">
        <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      </svg>
      <div>
        <h3 id="incPanelTitle">當日未完成動火提醒</h3>
        <p  id="incPanelDate">— 年 — 月 — 日</p>
      </div>
      <button class="close-btn" onclick="document.getElementById('incompletePanel').classList.remove('show')">關閉</button>
    </div>
    <div id="incompleteBd"><div style="text-align:center;padding:20px;color:#8e97aa">⏳ 載入中…</div></div>
  `;

  // 掛載：插在 queryResults 之前（或找 queryDate 的父容器）
  const anchor = document.getElementById('queryResults') || document.getElementById('queryDate')?.closest('div');
  if (anchor && anchor.parentNode) {
    anchor.parentNode.insertBefore(row, anchor);
    anchor.parentNode.insertBefore(panel, anchor);
  } else {
    // 找不到掛載點時 fallback 到 body 末尾
    document.body.appendChild(row);
    document.body.appendChild(panel);
  }
}

/** 點擊「未完成動火提醒」按鈕時呼叫 */
async function checkIncomplete() {
  const inputDate = document.getElementById('incDate')?.value || '';
  const panel     = document.getElementById('incompletePanel');
  const bd        = document.getElementById('incompleteBd');
  const titleEl   = document.getElementById('incPanelTitle');
  const dateEl    = document.getElementById('incPanelDate');

  if (!panel || !bd) return;

  // 顯示面板、捲動到位
  panel.classList.add('show');
  bd.innerHTML = '<div style="text-align:center;padding:20px;color:#8e97aa">⏳ 查詢中…</div>';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // 更新標題日期
  const targetDate = inputDate || new Date().toLocaleDateString('zh-TW', {
    timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit'
  }).replace(/\//g, '-');

  const d       = new Date(targetDate + 'T00:00:00');
  const isToday = targetDate === new Date().toLocaleDateString('zh-TW', {
    timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit'
  }).replace(/\//g, '-');

  dateEl.textContent  = `${d.getFullYear()} 年 ${d.getMonth()+1} 月 ${d.getDate()} 日`;
  titleEl.textContent = isToday ? '當日未完成動火提醒' : `${d.getMonth()+1}/${d.getDate()} 動火完成狀況`;

  try {
    const url = new URL(`${CONFIG.API_ENDPOINT}/api/check-incomplete`);
    if (inputDate) url.searchParams.set('date', inputDate);
    const json = await fetch(url).then(r => r.json());

    if (!json.success) throw new Error(json.error || '查詢失敗');

    const { incomplete, complete, total } = json;

    if (total === 0) {
      bd.innerHTML = `<div style="text-align:center;padding:20px;color:#8e97aa">
        📭 ${isToday ? '今日' : '該日期'}尚無任何動火前通報記錄</div>`;
      return;
    }

    if (incomplete.length === 0) {
      bd.innerHTML = `<div style="text-align:center;padding:16px;color:#0f7b5a;font-weight:700">
        🎉 ${isToday ? '今日' : '該日期'}所有廠商動火通報均已完整（共 ${complete.length} 筆）</div>`;
      return;
    }

    const items = incomplete.map(e => {
      const icon = !e.hasPre ? '🔴' : (!e.hasDuring ? '🟠' : '🟡');
      const tags = [
        `<span class="inc-tag ${e.hasPre     ? 'ok' : 'miss'}">${e.hasPre     ? '✓' : '✗'} 動火前</span>`,
        `<span class="inc-tag ${e.hasDuring  ? 'ok' : 'miss'}">${e.hasDuring  ? '✓' : '✗'} 動火中</span>`,
        `<span class="inc-tag ${e.hasAfter   ? 'ok' : 'miss'}">${e.hasAfter   ? '✓' : '✗'} 動火後</span>`,
      ].join('');
      return `<div class="incomplete-item">
        <div class="inc-ico">${icon}</div>
        <div class="inc-body">
          <div class="inc-co">${e.company}</div>
          <div class="inc-prj">${e.project || '—'}</div>
          <div class="inc-tags">${tags}</div>
        </div>
      </div>`;
    }).join('');

    const completedNote = complete.length > 0
      ? `<p style="font-size:.74rem;color:#8e97aa;margin-top:14px">另有 ${complete.length} 筆廠商通報已全部完成 ✓</p>`
      : '';

    bd.innerHTML = `
      <p style="font-size:.78rem;color:#4b5465;margin-bottom:14px">
        共發現 <strong style="color:#c0392b">${incomplete.length}</strong> 筆通報尚未完成（全部 ${total} 筆）
      </p>
      ${items}
      ${completedNote}
    `;
  } catch (err) {
    console.error('checkIncomplete 失敗:', err);
    bd.innerHTML = `<div style="text-align:center;padding:20px;color:#c0392b">❌ 查詢失敗：${err.message}</div>`;
  }
}


function val(id) { return document.getElementById(id)?.value || ''; }

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

Object.values(FORM_CONFIGS).forEach(setupFormSubmit);
