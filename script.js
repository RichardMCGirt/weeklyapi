// Airtable Setup
const AIRTABLE_API_KEY = 'patXTUS9m8os14OO1.6a81b7bc4dd88871072fe71f28b568070cc79035bc988de3d4228d52239c8238'; 
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
const MOCK_TODAY = new Date(2025, 6, 21); // Note: months are 0-based (8 = September)

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

// Returns: { [rowLabel]: { [dateHeader]: sum, ... }, ... }
async function getEstimatedSumsByTypeAndDate(dateHeaders) {
  const records1 = await fetchAllAirtableRecords1(); // Old table
  const records2 = await fetchAllAirtableRecords2(); // New table

  // Define these ONCE at the top:
  let residentialSums1 = {}, commercialSums1 = {};
  let residentialSums2 = {}, commercialSums2 = {};

  // ------- First Airtable (existing logic) -------
  for (const date of dateHeaders) {
    let sumResidential = 0, sumCommercial = 0;
    let [mm, dd] = date.split('/');
    let year = new Date().getFullYear();
    let headerDate = new Date(year, parseInt(mm, 10) - 1, parseInt(dd, 10));
    headerDate.setHours(0,0,0,0);

    for (const rec of records1) {
      if (!rec['Last Time Outcome Modified']) continue;
      let dateObj = new Date(rec['Last Time Outcome Modified']);
      dateObj.setHours(0,0,0,0);

      let diffDays = (headerDate - dateObj) / (1000 * 60 * 60 * 24);
      if (dateObj > headerDate || diffDays < 0 || diffDays > 8) continue;

      // Defensive extraction
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
    residentialSums1[date] = sumResidential || "";
    commercialSums1[date] = sumCommercial || "";
  }

  // ------- Second Airtable (new logic) -------
 for (const date of dateHeaders) {
  let sumResidential = 0, sumCommercial = 0;
  let [mm, dd] = date.split('/');
  let year = new Date().getFullYear();
  let headerDate = new Date(year, parseInt(mm, 10) - 1, parseInt(dd, 10));
  headerDate.setHours(0,0,0,0);

  console.log(`[Airtable2][SUM] === Calculating for header date: ${headerDate.toLocaleDateString()} (${date}) ===`);

  for (const rec of records2) {
    // Show all relevant fields for this record
    console.log('[Airtable2][CHECK] Bid $:', rec['Bid $'], '| Date Marked Completed:', rec['Date Marked Completed'], '| Project Type:', rec['Project Type']);

    if (
      rec['Bid $'] === undefined ||
      rec['Bid $'] === null ||
      String(rec['Bid $']).trim() === "" ||
      !rec['Date Marked Completed']
    ) {
      console.log('[Airtable2][SKIP] Missing Bid $ or Date Marked Completed.', rec);
      continue;
    }

    let dateObj = new Date(rec['Date Marked Completed']);
    dateObj.setHours(0,0,0,0);
    let diffDays = (headerDate - dateObj) / (1000 * 60 * 60 * 24);

    if (dateObj > headerDate || diffDays < 0 || diffDays > 8) {
      console.log(`[Airtable2][SKIP] Record outside date window (diffDays: ${diffDays}).`, rec);
      continue;
    }

    let projectTypeField = rec['Project Type'];
    let projectType = "";
    if (typeof projectTypeField === 'string') {
      projectType = projectTypeField.trim().toLowerCase();
    } else if (Array.isArray(projectTypeField) && projectTypeField.length > 0) {
      projectType = String(projectTypeField[0]).trim().toLowerCase();
    }
    let val = parseFloat(String(rec['Bid $'] || "0").replace(/[^0-9.\-]/g,""));

    if (projectType === 'commercial') {
      sumCommercial += val;
      console.log(`[Airtable2][COMMERCIAL] Adding $${val} to sumCommercial. New total: $${sumCommercial}`);
    } else if (projectType) {
      sumResidential += val;
      console.log(`[Airtable2][RESIDENTIAL] Adding $${val} to sumResidential. New total: $${sumResidential}`);
    } else {
      console.log(`[Airtable2][SKIP] Unknown or blank projectType for record.`, rec);
    }
  }

  console.log(`[Airtable2][RESULT] For ${date}: Residential=$${sumResidential}, Commercial=$${sumCommercial}`);

  residentialSums2[date] = sumResidential || "";
  commercialSums2[date] = sumCommercial || "";
}


  // ---- Return whichever mapping you want to rows ----
  return {
    // For old Airtable (example row names)
    "Sales - Residential": residentialSums1,
    "Sales - Commercial": commercialSums1,

    // For new Airtable (for these row names)
    "$ Residential Estimated": residentialSums2,
    "$ Commercial Estimated": commercialSums2
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

// Old source
async function fetchAllAirtableRecords1() {
  let allRecords = [];
  let offset = "";
  do {
    let url = `https://api.airtable.com/v0/appX1Saz7wMYh4hhm/tblfCPX293KlcKsdp?view=viwpf1PbJ7b7KLtjp`;
    if (offset) url += `&offset=${offset}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });
    const json = await resp.json();
    if (json.records) allRecords = allRecords.concat(json.records);
    offset = json.offset;
  } while (offset);
  return allRecords.map(r => r.fields);
}

// New source
async function fetchAllAirtableRecords2() {
  let allRecords = [];
  let offset = "";
  let pageCount = 0;

  do {
    let url = `https://api.airtable.com/v0/appK9gZS77OmsIK50/tblQo2148s04gVPq1?view=viwAI7zWIjUu1d2LT`;
    if (offset) url += `&offset=${offset}`;
    pageCount++;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });

    if (!resp.ok) {
      console.error(`[Airtable2] Failed to fetch: ${resp.status} ${resp.statusText}`);
      break;
    }

    const json = await resp.json();

    if (json.records) {
      allRecords = allRecords.concat(json.records);
    } else {
      console.warn(`[Airtable2] No records found on page ${pageCount}`);
    }

    offset = json.offset;
  } while (offset);

  // Remove all filtering, just return every record's fields:
  const result = allRecords.map(r => r.fields);

  console.log(`[Airtable2] Total records fetched: ${result.length}`);
  if (result.length > 0) {
    // Preview first 2 records for debugging
    console.log('[Airtable2] Example record:', result[0]);
    if (result.length > 1) {
      console.log('[Airtable2] Second record:', result[1]);
    }
  }

  return result;
}

async function renderTable(data) {
  if (!headers.length) return;

  // Find visible columns
  let visibleIndexes = [];
  headers.forEach((header, idx) => {
    if (!isFutureDateHeader(header)) visibleIndexes.push(idx);
  });

  // Column indexes
  const measurableColIdx = headers.findIndex(h => h.trim() === "Measurable");
  const goalColIdx = headers.findIndex(h => h.trim().toLowerCase() === "goal");
  const dateHeaders = visibleIndexes.map(i => headers[i])
    .filter(h => /^\d{2}\/\d{2}(\/\d{4})?$/.test(h));

  const overrides = await getEstimatedSumsByTypeAndDate(dateHeaders);

  // Section labels for row-only display
  const sectionLabels = ["PreCon", "Estimating", "Administration", "Field"];

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
    let goalValue = goalColIdx >= 0 ? row[goalColIdx] : "";

    // SECTION LABEL ROW: Only in Measurable column, rest blank
    if (sectionLabels.includes(measurable)) {
      html += `<tr class="${rIdx % 2 === 0 ? 'even' : 'odd'} section-row">`;
      visibleIndexes.forEach((_, idx) => {
        if (idx === measurableColIdx) {
          html += `<td colspan="1" style="font-weight:bold;">${measurable}</td>`;
        } else {
          html += `<td></td>`;
        }
      });
      html += '</tr>';
      return;
    }

    // Normal data row
    html += `<tr class="${rIdx % 2 === 0 ? 'even' : 'odd'}">`;
    visibleIndexes.forEach(i => {
      let colHeader = headers[i];
      let val = row[i];

      // Show override values for these rows (from Airtable)
      if (
        (
          measurable === "Sales - Residential" ||
          measurable === "Sales - Commercial" ||
          measurable === "$ Residential Estimated" ||
          measurable === "$ Commercial Estimated"
        ) &&
        dateHeaders.includes(colHeader)
      ) {
        let airVal = overrides[measurable][colHeader] || "";
        if (airVal !== "" && !isNaN(airVal)) {
          val = "$" + Number(airVal).toLocaleString();
        } else {
          val = airVal;
        }
      }

      // Hide specific text values
      if (val === "Omnna" || val === "Airtable" || val === "Mgmt") val = "";

      // --- DELTA logic: Show difference from Goal under value ---
      let cellHtml = `${val ?? ""}`;
      if (
        dateHeaders.includes(colHeader) &&
        measurable !== "Weeks Remaining FY" &&
        !/Weeks Remaining FY/i.test(measurable) &&
        !isNaN(parseFloat(val.toString().replace(/[^0-9.\-]/g, ""))) &&
        goalValue &&
        !isNaN(parseFloat(goalValue.toString().replace(/[^0-9.\-]/g, "")))
      ) {
        // Parse both as numbers
        let v = parseFloat(val.toString().replace(/[^0-9.\-]/g, ""));
        let g = parseFloat(goalValue.toString().replace(/[^0-9.\-]/g, ""));
        let delta = v - g;
        let deltaClass = delta > 0 ? "delta-positive" : delta < 0 ? "delta-negative" : "";
        let sign = delta > 0 ? "+" : "";
        let symbol = delta > 0 ? "Δ" : "∇"; // Δ for positive, ∇ for negative
        // Only show if not zero
        if (!isNaN(delta) && delta !== 0) {
          cellHtml += `<div class="delta ${deltaClass}">${symbol} ${sign}$${Math.abs(delta).toLocaleString()}</div>`;
        }
      }

      html += `<td>${cellHtml}</td>`;
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  document.getElementById('table-container').innerHTML = html;
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
    })
    .catch(() => {
      document.getElementById('table-container').innerHTML = "<p>No data found. Please upload a CSV file.</p>";
    });
}

// On page load: try localStorage, else fetch WeeklyGoals.csv
window.addEventListener('DOMContentLoaded', function() {
    loadDefaultCSV();
});

