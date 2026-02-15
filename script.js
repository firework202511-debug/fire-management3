// script.js - 完整邏輯版
const CONFIG = {
  API_ENDPOINT: 'https://fire-management-api.firework202511.workers.dev',
  MAX_WIDTH: 1024, JPEG_QUALITY: 0.75
};

let GLOBAL_ORG_DATA = {}; 
let GLOBAL_LOCATION_MAP = {}; // 儲存 PRE 資料產生的地點地圖 [cite: 52]

const FORM_CONFIGS = {
  pre: {
    formId: 'preForm', apiPath: '/api/submit-pre',
    photos: [{ inputId: 'prePhoto1', statusId: 'prePhoto1Status' }, { inputId: 'prePhoto2', statusId: 'prePhoto2Status' }],
    statusIds: ['prePhoto1Status', 'prePhoto2Status', 'preFormMsg'],
    getPayload: () => ({
      company: val('preCompany'), inputCompany: val('preInputCompany'),
      project: val('preProject'), inputProject: val('preInputProject'),
      uploader: val('preUploader'), department: `${val('preGroup')}-${val('preSection')}`,
      startTime: val('preStartTime'), endTime: val('preEndTime'),
      area: val('preArea'), location: val('preLocation'), restricted: val('preRestricted'),
      items: Array.from(document.querySelectorAll('input[name="fireItem"]:checked')).map(cb => cb.value).join(', ')
    })
  },
  during: {
    formId: 'duringForm', apiPath: '/api/submit-during',
    photos: [{ inputId: 'duringPhoto1', statusId: 'duringPhoto1Status' }, { inputId: 'duringPhoto2', statusId: 'duringPhoto2Status' }],
    statusIds: ['duringPhoto1Status', 'duringPhoto2Status', 'duringFormMsg'],
    getPayload: () => ({ company: val('duringCompany'), project: val('duringProject'), location: val('duringLocation'), q1: val('q1') })
  },
  after: {
    formId: 'afterForm', apiPath: '/api/submit-after',
    photos: [{ inputId: 'afterPhoto1', statusId: 'afterPhoto1Status' }, { inputId: 'afterPhoto2', statusId: 'afterPhoto2Status' }],
    statusIds: ['afterPhoto1Status', 'afterPhoto2Status', 'afterFormMsg'],
    getPayload: () => ({ company: val('afterCompany'), project: val('afterProject'), location: val('afterLocation'), qTime: val('qTime'), qYesNo: val('qYesNo') })
  }
};

async function initApp() {
  try {
    const res = await fetch(`${CONFIG.API_ENDPOINT}/api/dropdown-data`);
    const data = await res.json();
    GLOBAL_ORG_DATA = data.orgData || {};
    GLOBAL_LOCATION_MAP = data.locationMap || {}; // 接收後端處理好的地點資料 [cite: 52]

    fillSelect('preCompany', Object.keys(data.companies));
    fillSelect('duringCompany', Object.keys(data.companies));
    fillSelect('afterCompany', Object.keys(data.companies));
    fillSelect('queryCompany', Object.keys(data.companies));
    fillSelect('preGroup', Object.keys(GLOBAL_ORG_DATA));
    fillSelect('preArea', data.areas);

    const itemsDiv = document.getElementById('preItemsContainer');
    data.items.forEach(item => {
      itemsDiv.innerHTML += `<label><input type="checkbox" name="fireItem" value="${item}"> ${item}</label>`;
    });

    setupLinks(data.companies);
    document.getElementById('queryDate').value = new Date().toISOString().split('T')[0];
  } catch (err) { console.error('載入失敗', err); }
}

function setupLinks(companies) {
  const pairs = [
    { c: 'preCompany', p: 'preProject', l: null },
    { c: 'duringCompany', p: 'duringProject', l: 'duringLocation' },
    { c: 'afterCompany', p: 'afterProject', l: 'afterLocation' }
  ];

  pairs.forEach(link => {
    const cEl = document.getElementById(link.c);
    const pEl = document.getElementById(link.p);
    
    cEl.addEventListener('change', () => {
      fillSelect(link.p, companies[cEl.value] || []);
      if (link.l) fillSelect(link.l, []); // 清空地點
    });

    if (link.l) {
      pEl.addEventListener('change', () => {
        // 當工程變更時，從 GLOBAL_LOCATION_MAP 抓取地點 [cite: 53]
        const locs = (GLOBAL_LOCATION_MAP[cEl.value] && GLOBAL_LOCATION_MAP[cEl.value][pEl.value]) || [];
        fillSelect(link.l, locs);
      });
    }
  });
}

function onGroupChange() {
  fillSelect('preSection', GLOBAL_ORG_DATA[val('preGroup')] || []);
}

function fillSelect(id, list) {
  const el = document.getElementById(id);
  el.innerHTML = '<option value="">請選擇</option>';
  list.forEach(i => el.add(new Option(i, i)));
  if (!['queryCompany', 'preGroup', 'preSection', 'duringLocation', 'afterLocation'].includes(id)) {
    el.add(new Option('其他', '其他'));
  }
}

async function handleForm(config) {
  const form = document.getElementById(config.formId);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true; btn.textContent = '處理中...';
    try {
      const photoUrls = [];
      for (const p of config.photos) {
        const file = document.getElementById(p.inputId).files[0];
        if (file) {
           const res = await uploadPhoto(file);
           photoUrls.push(res.url);
           document.getElementById(p.statusId).textContent = '✅ 已上傳';
        }
      }
      const payload = config.getPayload();
      payload.photoUrls = photoUrls;
      const res = await fetch(`${CONFIG.API_ENDPOINT}${config.apiPath}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) { alert('送出成功'); form.reset(); config.statusIds.forEach(id => document.getElementById(id).textContent = ''); }
    } catch (err) { alert('失敗: ' + err.message); }
    finally { btn.disabled = false; btn.textContent = '送出'; }
  });
}

async function uploadPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async e => {
      const res = await fetch(`${CONFIG.API_ENDPOINT}/api/upload-photo`, {
        method: 'POST', body: JSON.stringify({ dataUrl: e.target.result, filename: file.name })
      });
      resolve(await res.json());
    };
    reader.readAsDataURL(file);
  });
}

async function searchRecords() {
  const res = await fetch(`${CONFIG.API_ENDPOINT}/api/search-records?date=${val('queryDate')}&company=${val('queryCompany')}`);
  const json = await res.json();
  let html = '<table class="result-table"><tr><th>時機</th><th>工程</th><th>地點</th><th>照片</th></tr>';
  json.data.forEach(r => {
    html += `<tr><td>${r.type}</td><td>${r.project}</td><td>${r.location}</td><td><a href="${r.photo1}" target="_blank">📷</a></td></tr>`;
  });
  document.getElementById('queryResults').innerHTML = html + '</table>';
}

function val(id) { return document.getElementById(id)?.value || ''; }

Object.values(FORM_CONFIGS).forEach(handleForm);
initApp();
