// Airtable Setup
const AIRTABLE_API_KEY = 'patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238'; // <-- Put your Airtable Personal Access Token here
const AIRTABLE_BASE_ID = 'appX1Saz7wMYh4hhm';
const AIRTABLE_TABLE_ID = 'tblfCPX293KlcKsdp';
const AIRTABLE_VIEW = 'viwpf1PbJ7b7KLtjp';

const sectionHeadersMap = [
  { label: "PreCon", columns: ["Revenue Goal"] },
  { label: "Estimating", columns: ["$ Residential Estimated"] },
  { label: "Administration", columns: ["Weeks Remaining FY"] },
  { label: "Field", columns: ["GP $ Goal Residential"] }
];
const extraCols = [];

let globalData = [], headers = [], visibleColIndexes = [];

// Util: CSV Parser
function parseCSV(csv, delimiter = ',') {
  const rows = [];
  let lines = csv.split(/\r?\n/).filter(Boolean);
  for (let line of lines) {
    let entries = [];
    let insideQuotes = false;
    let entry = '';
    for (let i = 0; i < line.length; i++) {
      let char = line[i];
      if (char === '"' && (i === 0 || line[i-1] !== '\\')) {
        insideQuotes = !insideQuotes;
      } else if (char === delimiter && !insideQuotes) {
        entries.push(entry.replace(/^"|"$/g, '').replace(/""/g, '"'));
        entry = '';
      } else {
        entry += char;
      }
    }
    entries.push(entry.replace(/^"|"$/g, '').replace(/""/g, '"'));
    rows.push(entries);
  }
  return rows;
}

// Section header row builder
function buildSectionHeaderRow(headers) {
  const colToSection = {};
  sectionHeadersMap.forEach(sec => {
    sec.columns.forEach(col => { colToSection[col] = sec.label; });
  });
  let lastSection = null, rowCells = [];
  headers.forEach((colName, i) => {
    const section = colToSection[colName] || "";
    if (section === lastSection && rowCells.length > 0) {
      rowCells[rowCells.length - 1].span++;
    } else {
      rowCells.push({ section, span: 1 });
      lastSection = section;
    }
  });
  let rowHtml = "<tr>";
  for (const cell of rowCells) {
    rowHtml += `<th class="section-header"${cell.span > 1 ? ` colspan="${cell.span}"` : ""}>${cell.section ? cell.section : ""}</th>`;
  }
  rowHtml += "</tr>";
  return rowHtml;
}

// Hide future date columns (MM/DD or MM/DD/YYYY)
function isFutureDateHeader(header) {
  const today = new Date();
  // MM/DD
  let match = /^(\d{2})\/(\d{2})$/.exec(header);
  if (match) {
    let year = today.getFullYear();
    let date = new Date(year, parseInt(match[1],10)-1, parseInt(match[2],10));
    if (date < today.setHours(0,0,0,0)) return false;
    return date > new Date(today.setHours(0,0,0,0));
  }
  // MM/DD/YYYY
  match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(header);
  if (match) {
    let date = new Date(match[3], parseInt(match[1],10)-1, parseInt(match[2],10));
    return date > new Date(today.setHours(0,0,0,0));
  }
  return false;
}
// TEST MODE: Fake today's date as September 12, 2025
const MOCK_TODAY = new Date(2025, 6, 15); // Note: months are 0-based (8 = September)

// Fetch Airtable values for a measurable row and an array of date fields
function isFutureDateHeader(header) {
  // Use mock date if set, otherwise real today
  const today = (typeof MOCK_TODAY !== "undefined" && MOCK_TODAY) ? new Date(MOCK_TODAY) : new Date();
  // MM/DD
  let match = /^(\d{2})\/(\d{2})$/.exec(header);
  if (match) {
    let year = today.getFullYear();
    let date = new Date(year, parseInt(match[1],10)-1, parseInt(match[2],10));
    if (date < today.setHours(0,0,0,0)) return false;
    return date > new Date(today.setHours(0,0,0,0));
  }
  // MM/DD/YYYY
  match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(header);
  if (match) {
    let date = new Date(match[3], parseInt(match[1],10)-1, parseInt(match[2],10));
    return date > new Date(today.setHours(0,0,0,0));
  }
  return false;
}

async function fetchAllAirtableRecords() {
  let allRecords = [];
  let offset = "";
  do {
    let url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}?view=${AIRTABLE_VIEW}`;
    if (offset) url += `&offset=${offset}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });
    const json = await resp.json();
    if (json.records) allRecords = allRecords.concat(json.records);
    offset = json.offset;
  } while (offset);
  console.log(`[Airtable] Fetched ${allRecords.length} records`);
  return allRecords.map(r => r.fields);
}

// Returns: { [rowLabel]: { [dateHeader]: sum, ... }, ... }
async function getEstimatedSumsByTypeAndDate(dateHeaders) {
  console.log('[Debug] Date Headers:', dateHeaders);
  const records = await fetchAllAirtableRecords();
  let residentialSums = {}, commercialSums = {};

  for (const date of dateHeaders) {
    let sumResidential = 0, sumCommercial = 0;
    let [mm, dd] = date.split('/');
    let headerDate = new Date(2025, parseInt(mm, 10) - 1, parseInt(dd, 10));
    headerDate.setHours(0,0,0,0);

    for (const rec of records) {
      if (!rec['Last Time Outcome Modified']) continue;
      let dateObj = new Date(rec['Last Time Outcome Modified']);
      dateObj.setHours(0,0,0,0);

      // Accept if record is in the last 7 days ending on headerDate
      let diffDays = (headerDate - dateObj) / (1000 * 60 * 60 * 24);
      if (dateObj > headerDate || diffDays < 0 || diffDays > 6) continue;

      // Defensive field extraction
      let projectTypeField = rec['Project Type'];
      let projectType = "";
      if (typeof projectTypeField === 'string') {
        projectType = projectTypeField.trim().toLowerCase();
      } else if (Array.isArray(projectTypeField) && projectTypeField.length > 0) {
        projectType = String(projectTypeField[0]).trim().toLowerCase();
      }

      let val = parseFloat(String(rec['Bid Value'] || "0").replace(/[^0-9.\-]/g,""));

      if (projectType === 'commercial') {
        sumCommercial += val;
      } else if (projectType) {
        sumResidential += val;
      }
    }
    residentialSums[date] = sumResidential || "";
    commercialSums[date] = sumCommercial || "";
  }

  console.log('[Debug] Final residential sums:', residentialSums);
  console.log('[Debug] Final commercial sums:', commercialSums);

  return {
    "$ Residential Estimated": residentialSums,
    "$ Commercial Estimated": commercialSums
  };
}



async function fetchAirtableRowValues(measurable, dateHeaders) {
  let formula = `{Measurable} = '${measurable}'`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}?view=${AIRTABLE_VIEW}&filterByFormula=${encodeURIComponent(formula)}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
  });
  const json = await resp.json();
  if (!json.records || !json.records.length) return {};
  const fields = json.records[0].fields;
  let values = {};
  for (const header of dateHeaders) {
    values[header] = fields[header] || "";
  }
  return values;
}

async function renderTable(data) {
  if (!headers.length) return;

  let visibleIndexes = [];
  headers.forEach((header, idx) => {
    if (!isFutureDateHeader(header)) visibleIndexes.push(idx);
  });

  const measurableColIdx = headers.findIndex(h => h.trim() === "Measurable");
  const dateHeaders = visibleIndexes.map(i => headers[i])
    .filter(h => /^\d{2}\/\d{2}(\/\d{4})?$/.test(h));

  const overrides = await getEstimatedSumsByTypeAndDate(dateHeaders);

  let html = '<table><thead>';
  html += buildSectionHeaderRow(visibleIndexes.map(i => headers[i]));
  html += '<tr>';
  visibleIndexes.forEach(i => {
    let label = headers[i] === "Data Source" ? "" : headers[i];
    html += `<th>${label}</th>`;
  });
  html += '</tr></thead><tbody>';

  data.forEach((row, rIdx) => {
    let measurable = (measurableColIdx >= 0 ? row[measurableColIdx] : "");
    html += `<tr class="${rIdx % 2 === 0 ? 'even' : 'odd'}">`;
    visibleIndexes.forEach(i => {
      let val = row[i];
    if (
  (measurable === "$ Residential Estimated" || measurable === "$ Commercial Estimated") &&
  dateHeaders.includes(headers[i])
) {
  let airVal = overrides[measurable][headers[i]] || "";
  // Format with $ and commas if a number
  if (airVal !== "" && !isNaN(airVal)) {
    val = "$" + Number(airVal).toLocaleString();
  } else {
    val = airVal;
  }
}

      if (val === "Omnna" || val === "Airtable" || val === "Mgmt") val = "";
      html += `<td>${val ?? ""}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('table-container').innerHTML = html;
}

// Save/load from localStorage (optional)
function saveToLocalStorage() {
  const obj = { headers, globalData };
  localStorage.setItem("weeklyGoalsTable", JSON.stringify(obj));
}
function loadFromLocalStorage() {
  const saved = localStorage.getItem("weeklyGoalsTable");
  if (saved) {
    try {
      const obj = JSON.parse(saved);
      if (Array.isArray(obj.headers) && Array.isArray(obj.globalData)) {
        headers = obj.headers;
        globalData = obj.globalData;
        renderTable(globalData);
        return true;
      }
    } catch (e) {}
  }
  return false;
}

// CSV loader from file upload
document.getElementById('csvFile').addEventListener('change', function(e) {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(ev) {
    const csv = ev.target.result;
    let arr = parseCSV(csv);
    if (arr.length < 2) {
      document.getElementById('table-container').innerHTML = "<p>No data found in file.</p>";
      return;
    }
    headers = extraCols.concat(arr[0].slice());
    globalData = arr.slice(1).map(row => {
      let newRow = row.slice();
      while (newRow.length < headers.length) newRow.push("");
      return newRow;
    });
    await renderTable(globalData); // <-- use await for async render
    saveToLocalStorage();
  };
  reader.readAsText(file);
});

// CSV loader from /WeeklyGoals.csv if available
async function loadDefaultCSV() {
  fetch('WeeklyGoals.csv')
    .then(async resp => {
      if (!resp.ok) throw new Error('Not found');
      return resp.text();
    })
    .then(async csv => {
      let arr = parseCSV(csv);
      if (arr.length < 2) {
        document.getElementById('table-container').innerHTML = "<p>No data found in WeeklyGoals.csv.</p>";
        return;
      }
      headers = extraCols.concat(arr[0].slice());
      globalData = arr.slice(1).map(row => {
        let newRow = row.slice();
        while (newRow.length < headers.length) newRow.push("");
        return newRow;
      });
      await renderTable(globalData); // <-- use await for async render
      saveToLocalStorage();
    })
    .catch(() => {
      document.getElementById('table-container').innerHTML = "<p>No data found. Please upload a CSV file.</p>";
    });
}

// On page load: try localStorage, else fetch WeeklyGoals.csv
window.addEventListener('DOMContentLoaded', function() {
  if (!loadFromLocalStorage()) {
    loadDefaultCSV();
  }
});
