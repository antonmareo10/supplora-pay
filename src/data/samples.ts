// What is printed on the six sample supplier invoices. Used by
// scripts/generate-samples.mjs to render the PNGs in /public/samples and by the
// rules-engine tests as "perfect extraction" fixtures. The app itself never reads
// this file: Claude reads the images.
//
// Deliberate issues:
//  01 Huerta del Guadalhorce  arithmetic error on one line (6 kg x 4.20 printed as 28.20)
//  02 Pescados Bahía          hake price up from 11.90 to 13.80 EUR/kg vs history
//  03 Cárnicas Hermanos Sanz  12 kg of presa invoiced, 10 kg on the signed delivery note
//  04 Green Valley Dairy      "reminder" copy of an invoice already paid on 9 Oct (duplicate)
//  05 Atlantic Wine & Spirits 2/10 net 30: 2% off if paid by 24 Oct
//  06 CleanPro                perfectly fine

export interface SampleLine {
  itemKey: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  /** Only when the printed line total is wrong. */
  printedTotal?: number;
  vat: number;
}

export interface SampleInvoice {
  file: string;
  supplierId: string;
  language: "es" | "en";
  style: "es-classic" | "es-modern" | "en-corporate" | "en-minimal";
  accent: string;
  supplierName: string;
  supplierTagline: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
  number: string;
  date: string;
  dueDate: string;
  terms: string;
  deliveryRef: string;
  lines: SampleLine[];
  payment: string;
  footer: string;
  stamp?: string;
}

export const SAMPLE_INVOICES: SampleInvoice[] = [
  {
    file: "01-huerta-guadalhorce.png",
    supplierId: "huerta-guadalhorce",
    language: "es",
    style: "es-classic",
    accent: "#3f6b2a",
    supplierName: "Huerta del Guadalhorce S.L.",
    supplierTagline: "Frutas y verduras de la vega · Desde 1987",
    taxId: "B29123456",
    address: "Camino de la Vega 22, 29590 Campanillas, Málaga",
    phone: "+34 952 431 118",
    email: "administracion@huertaguadalhorce.example",
    number: "HG-2026/0418",
    date: "2026-10-09",
    dueDate: "2026-10-23",
    terms: "Pago a 14 días",
    deliveryRef: "AL-1092",
    lines: [
      { itemKey: "hg.tomate-rosa", description: "Tomate rosa", qty: 12, unit: "kg", unitPrice: 2.85, vat: 4 },
      { itemKey: "hg.aguacate", description: "Aguacate Hass", qty: 6, unit: "kg", unitPrice: 4.2, printedTotal: 28.2, vat: 4 },
      { itemKey: "hg.patata", description: "Patata agria", qty: 25, unit: "kg", unitPrice: 0.95, vat: 4 },
      { itemKey: "hg.cebolla", description: "Cebolla dulce", qty: 10, unit: "kg", unitPrice: 1.4, vat: 4 },
      { itemKey: "hg.pimiento", description: "Pimiento italiano", qty: 6, unit: "kg", unitPrice: 2.6, vat: 4 },
      { itemKey: "hg.limon", description: "Limón", qty: 8, unit: "kg", unitPrice: 1.9, vat: 4 },
      { itemKey: "hg.lechuga", description: "Lechuga romana", qty: 18, unit: "ud", unitPrice: 0.85, vat: 4 },
      { itemKey: "hg.hierbabuena", description: "Hierbabuena (manojo)", qty: 10, unit: "manojo", unitPrice: 0.9, vat: 4 },
    ],
    payment: "Forma de pago: PayPal a cobros@huertaguadalhorce.example o transferencia ES21 2100 0418 4502 0005 1332",
    footer: "Inscrita en el Registro Mercantil de Málaga, Tomo 2841, Folio 112, Hoja MA-50921.",
  },
  {
    file: "02-pescados-bahia.png",
    supplierId: "pescados-bahia",
    language: "es",
    style: "es-modern",
    accent: "#1d4f7a",
    supplierName: "Pescados Bahía de Málaga S.L.",
    supplierTagline: "Pescado fresco de lonja · Mercado Mayorista de Málaga",
    taxId: "B29654321",
    address: "Mercado Mayorista, Nave 4, 29004 Málaga",
    phone: "+34 952 240 377",
    email: "facturacion@pescadosbahia.example",
    number: "FPB-26-1187",
    date: "2026-10-13",
    dueDate: "2026-10-20",
    terms: "Vencimiento 7 días fecha factura",
    deliveryRef: "AL-5521",
    lines: [
      { itemKey: "pb.merluza", description: "Merluza de pincho", qty: 14, unit: "kg", unitPrice: 13.8, vat: 10 },
      { itemKey: "pb.boqueron", description: "Boquerón fresco", qty: 8, unit: "kg", unitPrice: 6.5, vat: 10 },
      { itemKey: "pb.pulpo", description: "Pulpo cocido", qty: 5, unit: "kg", unitPrice: 22.4, vat: 10 },
      { itemKey: "pb.gamba", description: "Gamba blanca de Huelva", qty: 3, unit: "kg", unitPrice: 34.0, vat: 10 },
      { itemKey: "pb.calamar", description: "Calamar", qty: 6, unit: "kg", unitPrice: 12.8, vat: 10 },
    ],
    payment: "Pago por PayPal: cobros@pescadosbahia.example · Transferencia: ES76 0182 2370 4102 0158 3311",
    footer: "Pescados Bahía de Málaga S.L. · Registro Sanitario 12.04471/MA",
  },
  {
    file: "03-carnicas-sanz.png",
    supplierId: "carnicas-sanz",
    language: "es",
    style: "es-classic",
    accent: "#8a2c1d",
    supplierName: "Cárnicas Hermanos Sanz",
    supplierTagline: "Carnes selectas · Ibérico de bellota",
    taxId: "B18765432",
    address: "Polígono El Viso, C/ Ferrería 9, 29006 Málaga",
    phone: "+34 952 335 902",
    email: "javier@carnicassanz.example",
    number: "CHS-7731",
    date: "2026-10-10",
    dueDate: "2026-10-30",
    terms: "Pago a 20 días",
    deliveryRef: "AL-3307",
    lines: [
      { itemKey: "cs.presa", description: "Presa ibérica", qty: 12, unit: "kg", unitPrice: 18.5, vat: 10 },
      { itemKey: "cs.secreto", description: "Secreto ibérico", qty: 6, unit: "kg", unitPrice: 16.9, vat: 10 },
      { itemKey: "cs.solomillo", description: "Solomillo de ternera", qty: 4, unit: "kg", unitPrice: 32.0, vat: 10 },
      { itemKey: "cs.pollo", description: "Pollo de corral", qty: 8, unit: "ud", unitPrice: 9.75, vat: 10 },
      { itemKey: "cs.chorizo", description: "Chorizo ibérico", qty: 3, unit: "kg", unitPrice: 14.2, vat: 10 },
      { itemKey: "cs.lomo", description: "Lomo de cerdo", qty: 7.5, unit: "kg", unitPrice: 7.8, vat: 10 },
    ],
    payment: "Forma de pago: PayPal (pagos@carnicassanz.example) o transferencia ES12 3058 0754 1127 2000 4419",
    footer: "Cárnicas Hermanos Sanz · RGSEAA 10.012345/MA",
  },
  {
    file: "04-green-valley-dairy.png",
    supplierId: "green-valley",
    language: "en",
    style: "en-corporate",
    accent: "#2f6e4f",
    supplierName: "Green Valley Dairy Co.",
    supplierTagline: "Fresh dairy for the Costa del Sol trade",
    taxId: "ESW0012345B",
    address: "Unit 7, Parque Empresarial Guadalhorce, 29004 Málaga",
    phone: "+34 951 220 640",
    email: "accounts@greenvalleydairy.example",
    number: "GVD-2291",
    date: "2026-10-02",
    dueDate: "2026-11-01",
    terms: "Net 30 days",
    deliveryRef: "DN-88412",
    lines: [
      { itemKey: "gv.milk", description: "Whole milk 1L (case of 12)", qty: 6, unit: "case", unitPrice: 10.2, vat: 4 },
      { itemKey: "gv.cream", description: "Double cream 1L", qty: 8, unit: "unit", unitPrice: 4.35, vat: 10 },
      { itemKey: "gv.butter", description: "Unsalted butter 1kg", qty: 5, unit: "unit", unitPrice: 9.6, vat: 10 },
      { itemKey: "gv.manchego", description: "Manchego curado 3kg wheel", qty: 2, unit: "unit", unitPrice: 41.5, vat: 4 },
      { itemKey: "gv.yogurt", description: "Greek yogurt 1kg", qty: 6, unit: "unit", unitPrice: 5.1, vat: 10 },
    ],
    payment: "Pay by PayPal to payments@greenvalleydairy.example quoting the invoice number.",
    footer: "Green Valley Dairy Co. — Iberia branch. Thank you for your business.",
    stamp: "PAYMENT REMINDER · COPY",
  },
  {
    file: "05-atlantic-wine.png",
    supplierId: "atlantic-wine",
    language: "en",
    style: "en-minimal",
    accent: "#7a2236",
    supplierName: "Atlantic Wine & Spirits Ltd.",
    supplierTagline: "Importers & distributors since 1994",
    taxId: "ESN0067890H",
    address: "Avda. de Velázquez 120, 29003 Málaga",
    phone: "+34 952 177 455",
    email: "ar@atlanticwine.example",
    number: "AWS-50317",
    date: "2026-10-14",
    dueDate: "2026-11-13",
    terms: "2/10 net 30 — deduct 2% if paid within 10 days of invoice date",
    deliveryRef: "DN-2210",
    lines: [
      { itemKey: "aw.rioja", description: "Rioja Crianza 75cl", qty: 24, unit: "bottle", unitPrice: 7.9, vat: 21 },
      { itemKey: "aw.albarino", description: "Albariño Rías Baixas 75cl", qty: 18, unit: "bottle", unitPrice: 9.4, vat: 21 },
      { itemKey: "aw.victoria", description: "Cerveza Victoria 33cl (case of 24)", qty: 20, unit: "case", unitPrice: 17.8, vat: 21 },
      { itemKey: "aw.gin", description: "London dry gin 70cl", qty: 6, unit: "bottle", unitPrice: 19.5, vat: 21 },
      { itemKey: "aw.tonic", description: "Premium tonic 20cl (case of 24)", qty: 4, unit: "case", unitPrice: 14.4, vat: 21 },
      { itemKey: "aw.vermut", description: "Vermut rojo 1L", qty: 6, unit: "bottle", unitPrice: 11.2, vat: 21 },
    ],
    payment: "Remit via PayPal to payments@atlanticwine.example. Early-payment discount applies to payments received by 24 Oct 2026.",
    footer: "Atlantic Wine & Spirits Ltd. · Licensed wholesaler · Alcohol excise paid",
  },
  {
    file: "06-cleanpro.png",
    supplierId: "cleanpro",
    language: "en",
    style: "en-corporate",
    accent: "#0f6b6b",
    supplierName: "CleanPro Hospitality Supplies",
    supplierTagline: "Hygiene solutions for professional kitchens",
    taxId: "ESB0055501K",
    address: "C/ Brasil 31, Polígono Santa Cruz, 29006 Málaga",
    phone: "+34 952 099 312",
    email: "billing@cleanprohospitality.example",
    number: "CP-11902",
    date: "2026-10-06",
    dueDate: "2026-10-21",
    terms: "Net 15",
    deliveryRef: "DN-4471",
    lines: [
      { itemKey: "cp.degreaser", description: "Heavy-duty degreaser 5L", qty: 4, unit: "unit", unitPrice: 12.9, vat: 21 },
      { itemKey: "cp.dishwash", description: "Dishwasher detergent 20L", qty: 2, unit: "unit", unitPrice: 38.5, vat: 21 },
      { itemKey: "cp.rinse", description: "Rinse aid 10L", qty: 1, unit: "unit", unitPrice: 24.9, vat: 21 },
      { itemKey: "cp.gloves", description: "Nitrile gloves, box of 100", qty: 10, unit: "box", unitPrice: 6.8, vat: 21 },
      { itemKey: "cp.blueroll", description: "Blue roll, pack of 6", qty: 4, unit: "pack", unitPrice: 11.4, vat: 21 },
      { itemKey: "cp.sanitiser", description: "Food-safe sanitiser 750ml", qty: 12, unit: "unit", unitPrice: 3.2, vat: 21 },
    ],
    payment: "Payment by PayPal to payments@cleanprohospitality.example. Please quote invoice number.",
    footer: "CleanPro Hospitality Supplies · ISO 9001 certified distributor",
  },
];

/** Totals as printed: computed from the printed line totals (errors included). */
export function printedTotals(inv: SampleInvoice) {
  const lineCents = inv.lines.map((l) => Math.round((l.printedTotal ?? l.qty * l.unitPrice) * 100));
  const subtotal = lineCents.reduce((a, b) => a + b, 0);
  const byRate = new Map<number, number>();
  inv.lines.forEach((l, i) => byRate.set(l.vat, (byRate.get(l.vat) ?? 0) + lineCents[i]));
  const vat = [...byRate.entries()].map(([rate, base]) => ({ rate, base, vat: Math.round((base * rate) / 100) }));
  const vatTotal = vat.reduce((a, v) => a + v.vat, 0);
  return { lineCents, subtotal, vat, vatTotal, total: subtotal + vatTotal };
}
