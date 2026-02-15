// ================== 全域設定 ==================
const CONFIG = {
  MAX_WIDTH: 1024,
  JPEG_QUALITY: 0.75,
  MIN_QUALITY: 0.5,
  RETRY_COUNT: 3,
  RETRY_DELAY_BASE: 500,
  MAX_CONCURRENT_UPLOADS: 5,
  COMPRESSION_TIMEOUT: 8000,
  API_ENDPOINT: 'https://fire-management-api.firework202511.workers.dev'
};

// 全域變數：儲存資料
let GLOBAL_ORG_DATA = {};       // 組別-課別 對照表
let GLOBAL_LOCATION_MAP = {};   // 公司-工程-地點 對照表

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
        const checkedBoxes = document.querySelectorAll('input[name="fireItem"]:checked');
        const selectedItems = Array.from(checkedBoxes).map(cb => cb.value).join(', ');
        if (!selectedItems) throw new Error('請至少勾選一項動火項目');

        const group = getFieldValue('preGroup');
        const section = getFieldValue('preSection');
        if (!group || !section) throw new Error('請完整選擇主辦單位 (組與課)');

        return {
          company: getFieldValue('preCompany'),
          inputCompany: getFieldValue('preInputCompany'),
          project: getFieldValue('preProject'),
          inputProject: getFieldValue('preInputProject'),
          uploader: getFieldValue('preUploader'), 
          department: `${group}-${section}`,
          startTime: getFieldValue('preStartTime'),
          endTime: getFieldValue('preEndTime'),
          area: getFieldValue('preArea'),
          location: getFieldValue('preLocation'),
          restricted: getFieldValue('preRestricted'),
          items: selectedItems
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
    if (data.error) throw new Error(data.details);
    initDropdowns(data);
    const today = new Date().toISOString().split('T')[0];
    const queryDateEl = document.getElementById('queryDate');
    if (queryDateEl) queryDateEl.value = today;
  } catch (err) {
    console.error('初始化失敗:', err);
  }
}

function initDropdowns(data) {
  const { companies, areas, items, orgData, locationMap } = data;
  GLOBAL_ORG_DATA = orgData || {};
  GLOBAL_LOCATION_MAP = locationMap || {}; 

  ['preCompany', 'duringCompany', 'afterCompany', 'queryCompany'].forEach(id => {
    fillSelect(id, Object.keys(companies));
  });
  fillSelect('preGroup', Object.keys(GLOBAL_ORG_DATA));
  fillSelect('preArea', areas);
  
  const itemsContainer = document.getElementById('preItemsContainer');
  if (itemsContainer) {
    itemsContainer.innerHTML = '';
    if (items && items.length > 0) {
      items.forEach(item => {
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.gap = '5px';
        label.innerHTML = `<input type="checkbox" name="fireItem" value="${item}"> ${item}`;
        itemsContainer.appendChild(label);
      });
    }
  }
  setupCascadingDropdowns(companies);
}

function fillSelect(id, options) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '<option value="">請選擇</option>';
  if(options) options.forEach(opt => el.add(new Option(opt, opt)));
  const noOtherIds = ['queryCompany', 'preGroup', 'preSection', 'duringLocation', 'afterLocation'];
  if (!noOtherIds.includes(id)) el.add(new Option('其他', '其他'));
}

function onGroupChange() {
  const group = getFieldValue('preGroup');
  const sections = GLOBAL_ORG_DATA[group] || [];
  const sectionSelect = document.getElementById('preSection');
  if (sectionSelect) {
      sectionSelect.innerHTML = '<option value="">請選擇課別</option>';
      sections.forEach(sec => sectionSelect.add(new Option(sec, sec)));
  }
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
    companyEl.addEventListener('change', () => {
      const projects = companies[companyEl.value] || [];
      fillSelect(project, projects);
      if (locationEl) {
        fillSelect(location, []); 
        locationEl.innerHTML = '<option value="">請先選擇工程</option>';
      }
    });
    if (locationEl) {
      projectEl.addEventListener('change', () => {
        const selectedCompany = companyEl.value;
        const selectedProject = projectEl.value;
        let locations = [];
        if (GLOBAL_LOCATION_MAP[selectedCompany] && GLOBAL_LOCATION_MAP[selectedCompany][selectedProject]) {
          locations = GLOBAL_LOCATION_MAP[selectedCompany][selectedProject];
        }
        fillSelect(location, locations);
        if (locations.length === 0) locationEl.innerHTML = '<option value="">無相符地點</option>';
      });
    }
  });
}

// ================== 工具函式與圖片處理 ==================
function getFieldValue(id) { return document.getElementById(id)?.value || ''; }
function updateStatus(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function calculateDimensions(width, height, maxWidth) {
  const scale = Math.min(1, maxWidth / width);
  return { width: Math.round(width * scale), height: Math.round(height * scale), scale };
}
async function resizeImageProgressive(file, quality = CONFIG.JPEG_QUALITY) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('壓縮超時')), CONFIG.COMPRESSION_TIMEOUT);
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        try {
          const { width, height } = calculateDimensions(img.width, img.height, CONFIG.MAX_WIDTH);
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d', { alpha: false });
          ctx.drawImage(img, 0, 0, width, height);
          clearTimeout(timeout);
          resolve({ dataUrl: canvas.toDataURL('image/jpeg', quality), mime: 'image/jpeg', filename: file.name });
        } catch (err) { reject(err); }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
async function uploadWithSmartRetry(file, statusId) {
  let quality = CONFIG.JPEG_QUALITY;
  for (let attempt = 1; attempt <= CONFIG.RETRY_COUNT; attempt++) {
    try {
      updateStatus(statusId, `處理中 (${Math.round(quality * 100)}%)...`);
      const { dataUrl, mime, filename } = await resizeImageProgressive(file, quality);
      const result = await uploadQueue.add(() => uploadToServer(dataUrl, mime, filename));
      if (result?.success) { updateStatus(statusId, '✅ 成功'); return result.url; }
    } catch (err) {
      if (attempt === CONFIG.RETRY_COUNT) { updateStatus(statusId, '❌ 失敗'); throw err; }
      quality = Math.max(CONFIG.MIN_QUALITY, quality - 0.1);
    }
  }
}
async function uploadToServer(dataUrl, mime, filename) {
  const response = await fetch(`${CONFIG.API_ENDPOINT}/api/upload-photo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, mime, filename })
  });
  return response.json();
}
async function batchProcessPhotos(photos) {
  const results = [];
  for (const photo of photos) {
    const input = document.getElementById(photo.inputId);
    if (!input?.files?.length) { results.push(null); continue; }
    results.push(await uploadWithSmartRetry(input.files[0], photo.statusId));
  }
  return results;
}
function setupFormSubmit(config) {
  const form = document.getElementById(config.formId);
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const loadingEl = document.getElementById(config.loadingId);
    if (loadingEl) loadingEl.style.display = 'inline-block';
    try {
      const photoUrls = await batchProcessPhotos(config.photos);
      const payload = config.getPayload();
      payload.photoUrls = photoUrls;
      await submitToBackend(config.apiPath, payload);
      form.reset();
      config.statusIds.forEach(id => updateStatus(id, ''));
      alert('✅ 送出成功！');
    } catch (err) { alert('❌ 錯誤：' + err.message); }
    finally { if (loadingEl) loadingEl.style.display = 'none'; }
  });
}
async function submitToBackend(apiPath, payload) {
  const res = await fetch(`${CONFIG.API_ENDPOINT}${apiPath}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json();
}
async function searchRecords() {
  const date = val('queryDate');
  const company = val('queryCompany');
  const div = document.getElementById('queryResults');
  document.getElementById('queryLoading').style.display = 'block';
  try {
    const url = new URL(`${CONFIG.API_ENDPOINT}/api/search-records`);
    url.searchParams.append('date', date);
    if(company) url.searchParams.append('company', company);
    const res = await fetch(url);
    const json = await res.json();
    let html = `<table class="result-table"><thead><tr><th>時機</th><th>公司</th><th>工程</th><th>時間</th><th>地點</th><th>照片1</th><th>照片2</th></tr></thead><tbody>`;
    json.data.forEach(Row => {
      html += `<tr><td>${Row.type}</td><td>${Row.company}</td><td>${Row.project}</td><td>${Row.time}</td><td>${Row.location}</td><td>📷</td><td>📷</td></tr>`;
    });
    div.innerHTML = html + '</tbody></table>';
  } catch(e) { alert('查詢失敗'); }
  finally { document.getElementById('queryLoading').style.display = 'none'; }
}
function val(id) { return document.getElementById(id)?.value || ''; }
Object.values(FORM_CONFIGS).forEach(setupFormSubmit);
initApp();
