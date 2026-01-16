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

// 初始化
async function initApp() {
  try {
    const res = await fetch(`${CONFIG.API_ENDPOINT}/api/dropdown-data`);
    const data = await res.json();
    ['preCompany', 'duringCompany', 'afterCompany', 'queryCompany'].forEach(id => {
      const el = document.getElementById(id);
      el.innerHTML = '<option value="">請選擇</option>';
      Object.keys(data.companies).forEach(c => el.add(new Option(c, c)));
      if(id!=='queryCompany') el.add(new Option('其他','其他'));
      
      if(id!=='queryCompany') { // 連動工程
        el.addEventListener('change', () => {
          const projEl = document.getElementById(id.replace('Company','Project'));
          projEl.innerHTML = '<option value="">請選擇</option>';
          (data.companies[el.value]||[]).forEach(p => projEl.add(new Option(p,p)));
          projEl.add(new Option('其他','其他'));
        });
      }
    });
    const areaEl = document.getElementById('preArea');
    data.areas.forEach(a => areaEl.add(new Option(a,a)));
    const itemEl = document.getElementById('preItems');
    data.items.forEach(i => itemEl.add(new Option(i,i)));
    
    document.getElementById('queryDate').value = new Date().toISOString().split('T')[0];
  } catch(e) { console.error(e); alert('載入失敗'); }
}

// 圖片壓縮與上傳
async function uploadPhoto(file, statusId) {
  document.getElementById(statusId).textContent = '處理中...';
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, CONFIG.MAX_WIDTH / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale; canvas.height = img.height * scale;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        
        fetch(`${CONFIG.API_ENDPOINT}/api/upload-photo`, {
          method: 'POST', body: JSON.stringify({ dataUrl: canvas.toDataURL('image/jpeg', CONFIG.JPEG_QUALITY), filename: file.name })
        }).then(r=>r.json()).then(d=>{
          document.getElementById(statusId).textContent = '✅'; resolve(d.url);
        }).catch(reject);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// 表單提交
Object.values(FORM_CONFIGS).forEach(cfg => {
  document.getElementById(cfg.formId).addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true;
    document.getElementById(cfg.loadingId).style.display = 'block';
    
    try {
      const urls = [];
      for(const p of cfg.photos) {
        const f = document.getElementById(p.id).files[0];
        urls.push(f ? await uploadPhoto(f, p.s) : '');
      }
      const payload = cfg.getPayload(); payload.photoUrls = urls;
      
      const res = await fetch(`${CONFIG.API_ENDPOINT}${cfg.apiPath}`, {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
      });
      if(!res.ok) throw new Error('提交失敗');
      alert('✅ 成功'); e.target.reset(); cfg.photos.forEach(p=>document.getElementById(p.s).textContent='');
    } catch(err) { alert('❌ '+err.message); }
    finally { btn.disabled = false; document.getElementById(cfg.loadingId).style.display = 'none'; }
  });
});

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