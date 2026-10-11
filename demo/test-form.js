"use strict";

const form = document.getElementById("testForm");
const fields = Array.from(form.querySelectorAll(".test-field"));

for (const field of fields) {
  const badge = document.createElement("span");
  badge.className = "expectation";
  badge.textContent = field.dataset.expect || "確認対象";
  field.append(badge);
}

function controlFor(field) {
  return field.querySelector("input, select, textarea");
}

function hasValue(control) {
  if (control.type === "checkbox" || control.type === "radio") return control.checked;
  return String(control.value || "").trim().length > 0;
}

function updateSummary() {
  let filled = 0;
  let preserved = 0;
  let untouched = 0;

  for (const field of fields) {
    const control = controlFor(field);
    const isInitial = field.dataset.initial === "keep" && control.value === control.defaultValue;
    field.classList.toggle("has-value", hasValue(control));
    field.classList.toggle("is-preserved", isInitial);
    if (isInitial) preserved += 1;
    else if (hasValue(control)) filled += 1;
    else untouched += 1;
  }

  document.getElementById("filledCount").textContent = String(filled);
  document.getElementById("preservedCount").textContent = String(preserved);
  document.getElementById("untouchedCount").textContent = String(untouched);
}

form.addEventListener("input", updateSummary);
form.addEventListener("change", updateSummary);
form.addEventListener("reset", () => window.setTimeout(updateSummary, 0));

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const result = {};
  for (const control of form.elements) {
    if (!control.name) continue;
    if (control.autocomplete === "cc-number") {
      result[control.name] = control.value ? `末尾 ${control.value.replace(/\D/g, "").slice(-4)}` : "";
      continue;
    }
    if (control.autocomplete === "cc-csc") { result[control.name] = "表示しません"; continue; }
    result[control.name] = control.type === "checkbox" ? control.checked : control.value;
  }
  document.getElementById("resultJson").textContent = JSON.stringify(result, null, 2);
  const panel = document.getElementById("resultPanel");
  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
});

updateSummary();
