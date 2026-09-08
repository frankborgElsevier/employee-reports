/** DOM-independent request and response helpers for the Contractors page. */

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function normalise(value) {
  return value.trim().toLocaleLowerCase();
}

export function isManagerOption(value) {
  return (
    typeof value === "object" && value !== null && isNonEmptyString(value.id) && isNonEmptyString(value.name) &&
    typeof value.position === "string" && typeof value.country === "string" && typeof value.selectable === "boolean"
  );
}

export function isValidManagerOptions(body) {
  return typeof body === "object" && body !== null && Array.isArray(body.managers) && Array.isArray(body.positions) &&
    body.managers.every(isManagerOption) && body.positions.every(isNonEmptyString);
}

/** Makes choices comprehensible without using opaque option IDs as display text. */
export function managerChoices(options, currentManager = null) {
  const nameCounts = new Map();
  const contextCounts = new Map();
  for (const option of options) {
    const name = normalise(option.name);
    const context = `${name}\u0000${normalise(option.position)}\u0000${normalise(option.country)}`;
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    contextCounts.set(context, (contextCounts.get(context) ?? 0) + 1);
  }
  const choices = options.map((option) => {
    const name = normalise(option.name);
    const context = `${name}\u0000${normalise(option.position)}\u0000${normalise(option.country)}`;
    const duplicateName = (nameCounts.get(name) ?? 0) > 1;
    const indistinguishable = duplicateName && (contextCounts.get(context) ?? 0) > 1;
    const detail = [option.position.trim(), option.country.trim()].filter(Boolean).join(", ");
    return {
      id: option.id,
      label: duplicateName && detail ? `${option.name} — ${detail}` : option.name,
      available: option.selectable && !indistinguishable,
      unresolved: indistinguishable,
    };
  });
  if (currentManager !== null && !choices.some((choice) => choice.id === currentManager.id && choice.available)) {
    const detail = [currentManager.position.trim(), currentManager.country.trim()].filter(Boolean).join(", ");
    choices.unshift({
      id: currentManager.id,
      label: `${currentManager.name}${detail ? ` — ${detail}` : ""} (no longer current)`,
      available: false,
      unresolved: false,
    });
  }
  return choices;
}

export function managerIdFromFormValue(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.trim();
}

export function contractorRequestFromForm(form) {
  return {
    name: String(form.name ?? "").trim(), position: String(form.position ?? "").trim(), country: String(form.country ?? "").trim(),
    managerId: managerIdFromFormValue(form.managerId ?? form.manager),
  };
}

export function contractorDetailsRequestFromForm(form) {
  return { name: String(form.name ?? "").trim(), position: String(form.position ?? "").trim(), country: String(form.country ?? "").trim() };
}

export function contractorManagerRequestFromForm(form) {
  return { managerId: managerIdFromFormValue(form.managerId ?? form.manager) };
}

export function isManagerDescriptor(value) {
  return typeof value === "object" && value !== null && isNonEmptyString(value.id) && isNonEmptyString(value.name) &&
    typeof value.position === "string" && typeof value.country === "string";
}

export function isContractor(value) {
  return typeof value === "object" && value !== null && isNonEmptyString(value.id) && typeof value.name === "string" &&
    typeof value.position === "string" && typeof value.country === "string" && (value.manager === null || isManagerDescriptor(value.manager));
}

export function isValidContractorList(body) {
  return typeof body === "object" && body !== null && Array.isArray(body.contractors) && body.contractors.every(isContractor);
}

export function isCreatedContractor(body) {
  return typeof body === "object" && body !== null && isContractor(body.contractor);
}
