const clean = (v) => String(v ?? "").trim();

export function validateMyInvoisBuyer(buyer, { allowGeneralPublic = false } = {}) {
  const errors = {};
  if (allowGeneralPublic && clean(buyer?.name).toLowerCase() === "general public") {
    return { ok: true, errors };
  }
  const name = clean(buyer?.name);
  const tin = clean(buyer?.tin).toUpperCase().replace(/\s/g, "");
  const idType = clean(buyer?.idType).toUpperCase();
  const idNo = clean(buyer?.idNo).toUpperCase().replace(/[\s-]/g, "");
  const address = clean(buyer?.address);
  const city = clean(buyer?.city);
  const stateCode = clean(buyer?.stateCode);
  const postcode = clean(buyer?.postcode);

  if (name.length < 2) errors.name = "Buyer name is required";
  if (!/^[A-Z0-9]{6,20}$/.test(tin)) errors.tin = "A valid buyer TIN is required";
  if (!["NRIC", "PASSPORT", "BRN", "ARMY"].includes(idType)) errors.idType = "A supported buyer ID type is required";
  if (!idNo || idNo.length < 5 || idNo.length > 25) errors.idNo = "Buyer ID number is required";
  if (idType === "NRIC" && !/^\d{12}$/.test(idNo)) errors.idNo = "NRIC must contain 12 digits";
  if (!address) errors.address = "Buyer street address is required";
  if (!city) errors.city = "Buyer city is required";
  if (!/^\d{5}$/.test(postcode)) errors.postcode = "A 5-digit Malaysian postcode is required";
  if (!/^(0[1-9]|1[0-6])$/.test(stateCode)) errors.stateCode = "A Malaysian state code from 01 to 16 is required; 17 is not valid for an individual Malaysian buyer";

  return { ok: Object.keys(errors).length === 0, errors };
}
