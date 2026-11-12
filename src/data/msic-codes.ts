/**
 * Frequently used automotive MSIC codes from the official MyInvois MSIC 2008 list.
 * Keep this local so the workshop can search/select without opening the LHDN portal.
 * This is a focused automotive shortlist, not a replacement for DOSM's full classification.
 */
export type MsicCode = { code: string; description: string; keywords: string };

export const AUTOMOTIVE_MSIC_CODES: MsicCode[] = [
  { code: "00000", description: "NOT APPLICABLE", keywords: "not applicable tidak berkenaan" },
  { code: "45101", description: "Wholesale and retail of new motor vehicles", keywords: "new car sales kereta baru jualan" },
  { code: "45102", description: "Wholesale and retail of used motor vehicles", keywords: "used car sales kereta terpakai second hand" },
  { code: "45103", description: "Sale of industrial, commercial and agriculture vehicles – new", keywords: "commercial industrial agriculture vehicle lorry van" },
  { code: "45104", description: "Sale of industrial, commercial and agriculture vehicles – used", keywords: "used commercial industrial agriculture vehicle" },
  { code: "45105", description: "Sale by commission agents", keywords: "commission agent broker" },
  { code: "45106", description: "Car auctions", keywords: "auction lelong kereta" },
  { code: "45109", description: "Sale of other motor vehicles n.e.c.", keywords: "other motor vehicle sales" },
  { code: "45201", description: "Maintenance and repair of motor vehicles", keywords: "car workshop repair service maintenance bengkel kereta servis baiki" },
  { code: "45202", description: "Spraying and painting", keywords: "spray paint body paint ketuk cat" },
  { code: "45203", description: "Washing and polishing (car wash)", keywords: "car wash detailing polish cuci kereta" },
  { code: "45204", description: "Repair of motor vehicle seats", keywords: "seat upholstery kerusi" },
  { code: "45205", description: "Installation of parts and accessories not as part of the manufacturing process", keywords: "accessories installation pasang aksesori spare parts" },
  { code: "45300", description: "Wholesale and retail sale of all kinds of parts, components, supplies, tools and accessories for motor vehicles", keywords: "spare parts alat ganti accessories auto parts" },
  { code: "45401", description: "Wholesale and retail sale of motorcycles", keywords: "motorcycle motosikal motorbike" },
  { code: "45402", description: "Wholesale and retail sale of parts and accessories for motorcycles", keywords: "motorcycle spare parts motosikal alat ganti" },
  { code: "45403", description: "Repair and maintenance of motorcycles", keywords: "motorcycle repair servis baiki motosikal" },
  { code: "52212", description: "Towing and road side assistance", keywords: "towing breakdown bantuan tepi jalan trak tunda" },
  { code: "77101", description: "Renting and operational leasing of passenger cars (without driver)", keywords: "car rental sewa kereta" },
  { code: "77102", description: "Renting and operational leasing of trucks, utility trailers and recreational vehicles", keywords: "truck rental lorry trailer sewa lori" },
];
