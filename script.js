// Section header mapping for extra columns
const sectionHeadersMap = [
  { label: "PreCon", columns: ["Revenue Goal"] },
  { label: "Estimating", columns: ["$ Residential Estimated"] },
  { label: "Administration", columns: ["Weeks Remaining FY"] },
  { label: "Field", columns: ["GP $ Goal Residential"] }
];
const extraCols = [
 
];
let globalData = [], headers = [], visibleColIndexes = [];
let sortState = {col: null, dir: 1};

function buildSectionHeaderRow(headers) {
  // Map col name -> section label (for extraCols only)
  const colToSection = {};
  sectionHeadersMap.forEach(sec => {
    sec.columns.forEach(col => { colToSection[col] = sec.label; });
  });
  // Build array of {section, span}
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

function isFutureDateHeader(header) {
  // Try MM/DD and MM/DD/YYYY
  const today = new Date();
  // MM/DD
  let match = /^(\d{2})\/(\d{2})$/.exec(header);
  if (match) {
    let year = today.getFullYear();
    let date = new Date(year, parseInt(match[1],10)-1, parseInt(match[2],10));
    // If that date has already passed this year, assume it's for *next* year
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

// --- REPLACE renderTable with the following: ---
function renderTable(data) {
  if (!headers.length) return;

  // Compute visible columns: not future date headers
  let visibleIndexes = [];
  headers.forEach((header, idx) => {
    if (!isFutureDateHeader(header)) visibleIndexes.push(idx);
  });

  let html = '<table><thead>';

  // Section header row, filtered
  html += buildSectionHeaderRow(visibleIndexes.map(i => headers[i]));

  // Regular header row (with "Data Source" blanked out)
  html += '<tr>';
  visibleIndexes.forEach(i => {
    let label = headers[i] === "Data Source" ? "" : headers[i];
    html += `<th>${label}</th>`;
  });
  html += '</tr></thead><tbody>';

  // Data rows
  data.forEach((row, rIdx) => {
    html += `<tr class="${rIdx % 2 === 0 ? 'even' : 'odd'}">`;
    visibleIndexes.forEach(i => {
      let val = row[i];
      if (val === "Omnna" || val === "Airtable" || val === "Mgmt") val = "";
      html += `<td>${val ?? ""}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('table-container').innerHTML = html;
}



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
        return true; // loaded
      }
    } catch (e) {
      // Ignore corrupted storage
    }
  }
  return false; // not loaded
}

// --- New: Try to load /WeeklyGoals.csv if no localStorage and no file uploaded ---
function loadDefaultCSV() {
  fetch('WeeklyGoals.csv')
    .then(resp => {
      if (!resp.ok) throw new Error('Not found');
      return resp.text();
    })
    .then(csv => {
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
      renderTable(globalData);
      saveToLocalStorage();
    })
    .catch(() => {
      document.getElementById('table-container').innerHTML = "<p>No data found. Please upload a CSV file.</p>";
    });
}

// --- File upload handler ---
document.getElementById('csvFile').addEventListener('change', function(e) {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
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
    renderTable(globalData);
    saveToLocalStorage();
  };
  reader.readAsText(file);
});

// --- On load: try localStorage, otherwise fetch WeeklyGoals.csv
window.addEventListener('DOMContentLoaded', function() {
  if (!loadFromLocalStorage()) {
    loadDefaultCSV();
  }
});
