// Seed data for the demo restaurant. In production this comes from Supplora,
// which already captures every signed delivery note (albarán) and invoice line
// into the restaurant's purchasing history.
//
// Payout receivers (`paypalEmail`) use the reserved `.example` domain: the PayPal
// sandbox accepts payouts to any address and marks them UNCLAIMED until someone
// registers it. Point them at your own sandbox accounts (developer.paypal.com >
// Sandbox > Accounts), or set PAYPAL_PAYOUT_RECEIVER_OVERRIDE, to see SUCCESS.

import type {
  CatalogItem,
  DeliveryNote,
  InventoryItem,
  PaidInvoice,
  PriceHistory,
  StoreProduct,
  Supplier,
} from "../lib/types.ts";

export const RESTAURANT = {
  name: "Taberna El Faro",
  legalName: "El Faro Hostelería S.L.",
  taxId: "B93456781",
  address: "Calle Pozos Dulces 14, 29008 Málaga",
  owner: "Lucía Moreno",
  ownerFirstName: "Lucía",
  email: "lucia@tabernaelfaro.example",
};

export const SUPPLIERS: Supplier[] = [
  {
    id: "huerta-guadalhorce",
    name: "Huerta del Guadalhorce S.L.",
    category: "produce",
    language: "es",
    taxId: "B29123456",
    address: "Camino de la Vega 22, 29590 Campanillas, Málaga",
    contactName: "Antonio Ruiz",
    email: "administracion@huertaguadalhorce.example",
    phone: "+34 952 431 118",
    paypalEmail: "cobros@huertaguadalhorce.example",
    terms: { netDays: 14 },
    termsLabel: "Net 14",
    relationship: "Local growers, deliver Mon/Wed/Fri. Small family business; pays attention to on-time payment.",
  },
  {
    id: "pescados-bahia",
    name: "Pescados Bahía de Málaga S.L.",
    category: "fish",
    language: "es",
    taxId: "B29654321",
    address: "Mercado Mayorista, Nave 4, 29004 Málaga",
    contactName: "Rocío Fernández",
    email: "facturacion@pescadosbahia.example",
    phone: "+34 952 240 377",
    paypalEmail: "cobros@pescadosbahia.example",
    terms: { netDays: 7 },
    termsLabel: "Net 7",
    relationship: "Daily fish delivery and the restaurant's most critical supplier. Has stopped deliveries to late payers before.",
  },
  {
    id: "carnicas-sanz",
    name: "Cárnicas Hermanos Sanz",
    category: "meat",
    language: "es",
    taxId: "B18765432",
    address: "Polígono El Viso, C/ Ferrería 9, 29006 Málaga",
    contactName: "Javier Sanz",
    email: "javier@carnicassanz.example",
    phone: "+34 952 335 902",
    paypalEmail: "pagos@carnicassanz.example",
    terms: { netDays: 20 },
    termsLabel: "Net 20",
    relationship: "Twice-weekly meat delivery. Relaxed about payment dates as long as invoices are paid within terms.",
  },
  {
    id: "green-valley",
    name: "Green Valley Dairy Co.",
    category: "dairy",
    language: "en",
    taxId: "ESW0012345B",
    address: "Unit 7, Parque Empresarial Guadalhorce, 29004 Málaga",
    contactName: "Emma Clarke",
    email: "accounts@greenvalleydairy.example",
    phone: "+34 951 220 640",
    paypalEmail: "payments@greenvalleydairy.example",
    terms: { netDays: 30 },
    termsLabel: "Net 30",
    relationship: "Weekly dairy delivery. British-owned distributor on the Costa del Sol; invoices in English.",
  },
  {
    id: "atlantic-wine",
    name: "Atlantic Wine & Spirits Ltd.",
    category: "drinks",
    language: "en",
    taxId: "ESN0067890H",
    address: "Avda. de Velázquez 120, 29003 Málaga",
    contactName: "Oliver Grant",
    email: "ar@atlanticwine.example",
    phone: "+34 952 177 455",
    paypalEmail: "payments@atlanticwine.example",
    terms: { netDays: 30, discount: { percent: 2, withinDays: 10 } },
    termsLabel: "2/10 net 30",
    relationship: "Wine, beer and spirits. Offers 2% off for payment within 10 days. Runs an online trade store.",
    store: {
      tagline: "Wine, beer & spirits for the trade · next-day delivery on the Costa del Sol",
      accent: "#7a2236",
      leadTime: "Next-day delivery for orders before 18:00",
    },
  },
  {
    id: "cleanpro",
    name: "CleanPro Hospitality Supplies",
    category: "cleaning",
    language: "en",
    taxId: "ESB0055501K",
    address: "C/ Brasil 31, Polígono Santa Cruz, 29006 Málaga",
    contactName: "Sophie Turner",
    email: "billing@cleanprohospitality.example",
    phone: "+34 952 099 312",
    paypalEmail: "payments@cleanprohospitality.example",
    terms: { netDays: 15 },
    termsLabel: "Net 15",
    relationship: "Cleaning and hygiene consumables. Runs an online trade store with next-day delivery.",
    store: {
      tagline: "Hygiene & cleaning supplies for professional kitchens",
      accent: "#0f6b6b",
      leadTime: "Delivered tomorrow before 11:00",
    },
  },
];

export const CATALOG: CatalogItem[] = [
  // Huerta del Guadalhorce (fresh produce, 4% VAT)
  { key: "hg.tomate-rosa", supplierId: "huerta-guadalhorce", name: "Tomate rosa", unit: "kg", vatRate: 4 },
  { key: "hg.aguacate", supplierId: "huerta-guadalhorce", name: "Aguacate Hass", unit: "kg", vatRate: 4 },
  { key: "hg.patata", supplierId: "huerta-guadalhorce", name: "Patata agria", unit: "kg", vatRate: 4 },
  { key: "hg.cebolla", supplierId: "huerta-guadalhorce", name: "Cebolla dulce", unit: "kg", vatRate: 4 },
  { key: "hg.pimiento", supplierId: "huerta-guadalhorce", name: "Pimiento italiano", unit: "kg", vatRate: 4 },
  { key: "hg.limon", supplierId: "huerta-guadalhorce", name: "Limón", unit: "kg", vatRate: 4 },
  { key: "hg.lechuga", supplierId: "huerta-guadalhorce", name: "Lechuga romana", unit: "ud", vatRate: 4 },
  { key: "hg.hierbabuena", supplierId: "huerta-guadalhorce", name: "Hierbabuena", unit: "manojo", vatRate: 4 },
  // Pescados Bahía (10% VAT)
  { key: "pb.merluza", supplierId: "pescados-bahia", name: "Merluza de pincho", unit: "kg", vatRate: 10 },
  { key: "pb.boqueron", supplierId: "pescados-bahia", name: "Boquerón fresco", unit: "kg", vatRate: 10 },
  { key: "pb.pulpo", supplierId: "pescados-bahia", name: "Pulpo cocido", unit: "kg", vatRate: 10 },
  { key: "pb.gamba", supplierId: "pescados-bahia", name: "Gamba blanca de Huelva", unit: "kg", vatRate: 10 },
  { key: "pb.calamar", supplierId: "pescados-bahia", name: "Calamar", unit: "kg", vatRate: 10 },
  // Cárnicas Hermanos Sanz (10% VAT)
  { key: "cs.presa", supplierId: "carnicas-sanz", name: "Presa ibérica", unit: "kg", vatRate: 10 },
  { key: "cs.secreto", supplierId: "carnicas-sanz", name: "Secreto ibérico", unit: "kg", vatRate: 10 },
  { key: "cs.solomillo", supplierId: "carnicas-sanz", name: "Solomillo de ternera", unit: "kg", vatRate: 10 },
  { key: "cs.pollo", supplierId: "carnicas-sanz", name: "Pollo de corral", unit: "ud", vatRate: 10 },
  { key: "cs.chorizo", supplierId: "carnicas-sanz", name: "Chorizo ibérico", unit: "kg", vatRate: 10 },
  { key: "cs.lomo", supplierId: "carnicas-sanz", name: "Lomo de cerdo", unit: "kg", vatRate: 10 },
  // Green Valley Dairy
  { key: "gv.milk", supplierId: "green-valley", name: "Whole milk 1L (case of 12)", unit: "case", vatRate: 4 },
  { key: "gv.cream", supplierId: "green-valley", name: "Double cream 1L", unit: "unit", vatRate: 10 },
  { key: "gv.butter", supplierId: "green-valley", name: "Unsalted butter 1kg", unit: "unit", vatRate: 10 },
  { key: "gv.manchego", supplierId: "green-valley", name: "Manchego curado 3kg wheel", unit: "unit", vatRate: 4 },
  { key: "gv.yogurt", supplierId: "green-valley", name: "Greek yogurt 1kg", unit: "unit", vatRate: 10 },
  // Atlantic Wine & Spirits (21% VAT)
  { key: "aw.rioja", supplierId: "atlantic-wine", name: "Rioja Crianza 75cl", unit: "bottle", vatRate: 21 },
  { key: "aw.albarino", supplierId: "atlantic-wine", name: "Albariño Rías Baixas 75cl", unit: "bottle", vatRate: 21 },
  { key: "aw.victoria", supplierId: "atlantic-wine", name: "Cerveza Victoria 33cl (case of 24)", unit: "case", vatRate: 21 },
  { key: "aw.gin", supplierId: "atlantic-wine", name: "London dry gin 70cl", unit: "bottle", vatRate: 21 },
  { key: "aw.tonic", supplierId: "atlantic-wine", name: "Premium tonic 20cl (case of 24)", unit: "case", vatRate: 21 },
  { key: "aw.vermut", supplierId: "atlantic-wine", name: "Vermut rojo 1L", unit: "bottle", vatRate: 21 },
  // CleanPro (21% VAT)
  { key: "cp.degreaser", supplierId: "cleanpro", name: "Heavy-duty degreaser 5L", unit: "unit", vatRate: 21 },
  { key: "cp.dishwash", supplierId: "cleanpro", name: "Dishwasher detergent 20L", unit: "unit", vatRate: 21 },
  { key: "cp.rinse", supplierId: "cleanpro", name: "Rinse aid 10L", unit: "unit", vatRate: 21 },
  { key: "cp.gloves", supplierId: "cleanpro", name: "Nitrile gloves, box of 100", unit: "box", vatRate: 21 },
  { key: "cp.blueroll", supplierId: "cleanpro", name: "Blue roll, pack of 6", unit: "pack", vatRate: 21 },
  { key: "cp.sanitiser", supplierId: "cleanpro", name: "Food-safe sanitiser 750ml", unit: "unit", vatRate: 21 },
];

// Prices the restaurant paid on recent invoices (euros), oldest first.
const P = (date: string, price: number, ref: string) => ({ date, unitPriceCents: Math.round(price * 100), ref });

export const PRICE_HISTORY: PriceHistory[] = [
  { supplierId: "huerta-guadalhorce", itemKey: "hg.tomate-rosa", points: [P("2026-09-25", 2.8, "HG-2026/0391"), P("2026-10-02", 2.85, "HG-2026/0405")] },
  { supplierId: "huerta-guadalhorce", itemKey: "hg.aguacate", points: [P("2026-09-25", 4.2, "HG-2026/0391"), P("2026-10-02", 4.2, "HG-2026/0405")] },
  { supplierId: "huerta-guadalhorce", itemKey: "hg.patata", points: [P("2026-09-25", 0.95, "HG-2026/0391"), P("2026-10-02", 0.95, "HG-2026/0405")] },
  { supplierId: "huerta-guadalhorce", itemKey: "hg.cebolla", points: [P("2026-09-25", 1.4, "HG-2026/0391"), P("2026-10-02", 1.4, "HG-2026/0405")] },
  { supplierId: "huerta-guadalhorce", itemKey: "hg.pimiento", points: [P("2026-09-25", 2.6, "HG-2026/0391"), P("2026-10-02", 2.6, "HG-2026/0405")] },
  { supplierId: "huerta-guadalhorce", itemKey: "hg.limon", points: [P("2026-09-25", 1.9, "HG-2026/0391"), P("2026-10-02", 1.9, "HG-2026/0405")] },
  { supplierId: "huerta-guadalhorce", itemKey: "hg.lechuga", points: [P("2026-09-25", 0.85, "HG-2026/0391"), P("2026-10-02", 0.85, "HG-2026/0405")] },
  { supplierId: "huerta-guadalhorce", itemKey: "hg.hierbabuena", points: [P("2026-09-25", 0.9, "HG-2026/0391"), P("2026-10-02", 0.9, "HG-2026/0405")] },
  { supplierId: "pescados-bahia", itemKey: "pb.merluza", points: [P("2026-09-15", 11.9, "FPB-26-1063"), P("2026-09-29", 11.9, "FPB-26-1102"), P("2026-10-06", 11.9, "FPB-26-1141")] },
  { supplierId: "pescados-bahia", itemKey: "pb.boqueron", points: [P("2026-09-29", 6.5, "FPB-26-1102"), P("2026-10-06", 6.5, "FPB-26-1141")] },
  { supplierId: "pescados-bahia", itemKey: "pb.pulpo", points: [P("2026-09-29", 22.4, "FPB-26-1102"), P("2026-10-06", 22.4, "FPB-26-1141")] },
  { supplierId: "pescados-bahia", itemKey: "pb.gamba", points: [P("2026-09-15", 33.5, "FPB-26-1063"), P("2026-10-06", 34.0, "FPB-26-1141")] },
  { supplierId: "pescados-bahia", itemKey: "pb.calamar", points: [P("2026-09-29", 12.6, "FPB-26-1102"), P("2026-10-06", 12.6, "FPB-26-1141")] },
  { supplierId: "carnicas-sanz", itemKey: "cs.presa", points: [P("2026-09-19", 18.5, "CHS-7650"), P("2026-10-03", 18.5, "CHS-7702")] },
  { supplierId: "carnicas-sanz", itemKey: "cs.secreto", points: [P("2026-09-19", 16.9, "CHS-7650"), P("2026-10-03", 16.9, "CHS-7702")] },
  { supplierId: "carnicas-sanz", itemKey: "cs.solomillo", points: [P("2026-09-19", 32.0, "CHS-7650"), P("2026-10-03", 32.0, "CHS-7702")] },
  { supplierId: "carnicas-sanz", itemKey: "cs.pollo", points: [P("2026-09-19", 9.75, "CHS-7650"), P("2026-10-03", 9.75, "CHS-7702")] },
  { supplierId: "carnicas-sanz", itemKey: "cs.chorizo", points: [P("2026-09-19", 14.2, "CHS-7650"), P("2026-10-03", 14.2, "CHS-7702")] },
  { supplierId: "carnicas-sanz", itemKey: "cs.lomo", points: [P("2026-09-19", 7.8, "CHS-7650"), P("2026-10-03", 7.8, "CHS-7702")] },
  { supplierId: "green-valley", itemKey: "gv.milk", points: [P("2026-09-18", 10.2, "GVD-2244"), P("2026-10-02", 10.2, "GVD-2291")] },
  { supplierId: "green-valley", itemKey: "gv.cream", points: [P("2026-09-18", 4.35, "GVD-2244"), P("2026-10-02", 4.35, "GVD-2291")] },
  { supplierId: "green-valley", itemKey: "gv.butter", points: [P("2026-09-18", 9.6, "GVD-2244"), P("2026-10-02", 9.6, "GVD-2291")] },
  { supplierId: "green-valley", itemKey: "gv.manchego", points: [P("2026-09-18", 41.5, "GVD-2244"), P("2026-10-02", 41.5, "GVD-2291")] },
  { supplierId: "green-valley", itemKey: "gv.yogurt", points: [P("2026-09-18", 5.1, "GVD-2244"), P("2026-10-02", 5.1, "GVD-2291")] },
  { supplierId: "atlantic-wine", itemKey: "aw.rioja", points: [P("2026-09-12", 7.9, "AWS-49880")] },
  { supplierId: "atlantic-wine", itemKey: "aw.albarino", points: [P("2026-09-12", 9.4, "AWS-49880")] },
  { supplierId: "atlantic-wine", itemKey: "aw.victoria", points: [P("2026-09-12", 17.8, "AWS-49880")] },
  { supplierId: "atlantic-wine", itemKey: "aw.gin", points: [P("2026-09-12", 19.5, "AWS-49880")] },
  { supplierId: "atlantic-wine", itemKey: "aw.tonic", points: [P("2026-09-12", 14.4, "AWS-49880")] },
  { supplierId: "atlantic-wine", itemKey: "aw.vermut", points: [P("2026-09-12", 11.2, "AWS-49880")] },
  { supplierId: "cleanpro", itemKey: "cp.degreaser", points: [P("2026-09-06", 12.9, "CP-11721")] },
  { supplierId: "cleanpro", itemKey: "cp.dishwash", points: [P("2026-09-06", 38.5, "CP-11721")] },
  { supplierId: "cleanpro", itemKey: "cp.rinse", points: [P("2026-09-06", 24.9, "CP-11721")] },
  { supplierId: "cleanpro", itemKey: "cp.gloves", points: [P("2026-09-06", 6.8, "CP-11721")] },
  { supplierId: "cleanpro", itemKey: "cp.blueroll", points: [P("2026-09-06", 11.4, "CP-11721")] },
  { supplierId: "cleanpro", itemKey: "cp.sanitiser", points: [P("2026-09-06", 3.2, "CP-11721")] },
];

// Delivery notes captured by Supplora when the goods arrived (what was actually received).
export const DELIVERY_NOTES: DeliveryNote[] = [
  {
    id: "dn-hg-1092",
    supplierId: "huerta-guadalhorce",
    number: "AL-1092",
    date: "2026-10-09",
    receivedBy: "Marta (kitchen)",
    lines: [
      { itemKey: "hg.tomate-rosa", description: "Tomate rosa", qty: 12, unit: "kg" },
      { itemKey: "hg.aguacate", description: "Aguacate Hass", qty: 6, unit: "kg" },
      { itemKey: "hg.patata", description: "Patata agria", qty: 25, unit: "kg" },
      { itemKey: "hg.cebolla", description: "Cebolla dulce", qty: 10, unit: "kg" },
      { itemKey: "hg.pimiento", description: "Pimiento italiano", qty: 6, unit: "kg" },
      { itemKey: "hg.limon", description: "Limón", qty: 8, unit: "kg" },
      { itemKey: "hg.lechuga", description: "Lechuga romana", qty: 18, unit: "ud" },
      { itemKey: "hg.hierbabuena", description: "Hierbabuena", qty: 10, unit: "manojo" },
    ],
  },
  {
    id: "dn-pb-5521",
    supplierId: "pescados-bahia",
    number: "AL-5521",
    date: "2026-10-13",
    receivedBy: "Javi (kitchen)",
    lines: [
      { itemKey: "pb.merluza", description: "Merluza de pincho", qty: 14, unit: "kg" },
      { itemKey: "pb.boqueron", description: "Boquerón fresco", qty: 8, unit: "kg" },
      { itemKey: "pb.pulpo", description: "Pulpo cocido", qty: 5, unit: "kg" },
      { itemKey: "pb.gamba", description: "Gamba blanca de Huelva", qty: 3, unit: "kg" },
      { itemKey: "pb.calamar", description: "Calamar", qty: 6, unit: "kg" },
    ],
  },
  {
    id: "dn-cs-3307",
    supplierId: "carnicas-sanz",
    number: "AL-3307",
    date: "2026-10-10",
    receivedBy: "Marta (kitchen)",
    lines: [
      { itemKey: "cs.presa", description: "Presa ibérica", qty: 10, unit: "kg" },
      { itemKey: "cs.secreto", description: "Secreto ibérico", qty: 6, unit: "kg" },
      { itemKey: "cs.solomillo", description: "Solomillo de ternera", qty: 4, unit: "kg" },
      { itemKey: "cs.pollo", description: "Pollo de corral", qty: 8, unit: "ud" },
      { itemKey: "cs.chorizo", description: "Chorizo ibérico", qty: 3, unit: "kg" },
      { itemKey: "cs.lomo", description: "Lomo de cerdo", qty: 7.5, unit: "kg" },
    ],
  },
  {
    id: "dn-gv-88412",
    supplierId: "green-valley",
    number: "DN-88412",
    date: "2026-10-02",
    receivedBy: "Lucía (owner)",
    lines: [
      { itemKey: "gv.milk", description: "Whole milk 1L (case of 12)", qty: 6, unit: "case" },
      { itemKey: "gv.cream", description: "Double cream 1L", qty: 8, unit: "unit" },
      { itemKey: "gv.butter", description: "Unsalted butter 1kg", qty: 5, unit: "unit" },
      { itemKey: "gv.manchego", description: "Manchego curado 3kg wheel", qty: 2, unit: "unit" },
      { itemKey: "gv.yogurt", description: "Greek yogurt 1kg", qty: 6, unit: "unit" },
    ],
  },
  {
    id: "dn-aw-2210",
    supplierId: "atlantic-wine",
    number: "DN-2210",
    date: "2026-10-14",
    receivedBy: "Lucía (owner)",
    lines: [
      { itemKey: "aw.rioja", description: "Rioja Crianza 75cl", qty: 24, unit: "bottle" },
      { itemKey: "aw.albarino", description: "Albariño Rías Baixas 75cl", qty: 18, unit: "bottle" },
      { itemKey: "aw.victoria", description: "Cerveza Victoria 33cl (case of 24)", qty: 20, unit: "case" },
      { itemKey: "aw.gin", description: "London dry gin 70cl", qty: 6, unit: "bottle" },
      { itemKey: "aw.tonic", description: "Premium tonic 20cl (case of 24)", qty: 4, unit: "case" },
      { itemKey: "aw.vermut", description: "Vermut rojo 1L", qty: 6, unit: "bottle" },
    ],
  },
  {
    id: "dn-cp-4471",
    supplierId: "cleanpro",
    number: "DN-4471",
    date: "2026-10-06",
    receivedBy: "Javi (kitchen)",
    lines: [
      { itemKey: "cp.degreaser", description: "Heavy-duty degreaser 5L", qty: 4, unit: "unit" },
      { itemKey: "cp.dishwash", description: "Dishwasher detergent 20L", qty: 2, unit: "unit" },
      { itemKey: "cp.rinse", description: "Rinse aid 10L", qty: 1, unit: "unit" },
      { itemKey: "cp.gloves", description: "Nitrile gloves, box of 100", qty: 10, unit: "box" },
      { itemKey: "cp.blueroll", description: "Blue roll, pack of 6", qty: 4, unit: "pack" },
      { itemKey: "cp.sanitiser", description: "Food-safe sanitiser 750ml", qty: 12, unit: "unit" },
    ],
  },
  {
    id: "dn-cp-4502",
    supplierId: "cleanpro",
    number: "DN-4502",
    date: "2026-10-14",
    receivedBy: "Javi (kitchen)",
    lines: [
      { itemKey: "cp.degreaser", description: "Heavy-duty degreaser 5L", qty: 4, unit: "unit" },
      { itemKey: "cp.rinse", description: "Rinse aid 10L", qty: 2, unit: "unit" },
      { itemKey: "cp.blueroll", description: "Blue roll, pack of 6", qty: 4, unit: "pack" },
      { itemKey: "cp.sanitiser", description: "Food-safe sanitiser 750ml", qty: 12, unit: "unit" },
    ],
  },
];

export const PAID_INVOICES: PaidInvoice[] = [
  { supplierId: "huerta-guadalhorce", invoiceNumber: "HG-2026/0391", amountCents: 14820, paidAt: "2026-09-29", method: "bank_transfer", reference: "TRF-20260929-031" },
  { supplierId: "huerta-guadalhorce", invoiceNumber: "HG-2026/0405", amountCents: 15536, paidAt: "2026-10-09", method: "bank_transfer", reference: "TRF-20261009-112" },
  { supplierId: "pescados-bahia", invoiceNumber: "FPB-26-1102", amountCents: 51240, paidAt: "2026-10-02", method: "bank_transfer", reference: "TRF-20261002-077" },
  { supplierId: "pescados-bahia", invoiceNumber: "FPB-26-1141", amountCents: 49830, paidAt: "2026-10-09", method: "bank_transfer", reference: "TRF-20261009-113" },
  { supplierId: "carnicas-sanz", invoiceNumber: "CHS-7650", amountCents: 70125, paidAt: "2026-10-05", method: "bank_transfer", reference: "TRF-20261005-090" },
  { supplierId: "green-valley", invoiceNumber: "GVD-2244", amountCents: 25930, paidAt: "2026-09-30", method: "bank_transfer", reference: "TRF-20260930-052" },
  { supplierId: "green-valley", invoiceNumber: "GVD-2291", amountCents: 27471, paidAt: "2026-10-09", method: "bank_transfer", reference: "TRF-20261009-114" },
  { supplierId: "atlantic-wine", invoiceNumber: "AWS-49880", amountCents: 108940, paidAt: "2026-09-21", method: "bank_transfer", reference: "TRF-20260921-018" },
  { supplierId: "cleanpro", invoiceNumber: "CP-11721", amountCents: 34210, paidAt: "2026-09-19", method: "bank_transfer", reference: "TRF-20260919-009" },
];

// Online trade stores (only suppliers with `store` set have one).
export const STORE_PRODUCTS: StoreProduct[] = [
  { sku: "CP-DEG-5", supplierId: "cleanpro", name: "Heavy-duty degreaser", pack: "5 L", unitPriceCents: 1290, vatRate: 21, inStock: 64 },
  { sku: "CP-DW-20", supplierId: "cleanpro", name: "Dishwasher detergent", pack: "20 L", unitPriceCents: 3850, vatRate: 21, inStock: 22 },
  { sku: "CP-RA-10", supplierId: "cleanpro", name: "Rinse aid", pack: "10 L", unitPriceCents: 2490, vatRate: 21, inStock: 30 },
  { sku: "CP-GLV-100", supplierId: "cleanpro", name: "Nitrile gloves, size M", pack: "Box of 100", unitPriceCents: 680, vatRate: 21, inStock: 240 },
  { sku: "CP-BR-6", supplierId: "cleanpro", name: "Blue roll", pack: "Pack of 6", unitPriceCents: 1140, vatRate: 21, inStock: 85 },
  { sku: "CP-SAN-750", supplierId: "cleanpro", name: "Food-safe sanitiser spray", pack: "750 ml", unitPriceCents: 320, vatRate: 21, inStock: 300 },
  { sku: "CP-BAG-50", supplierId: "cleanpro", name: "Bin bags 120 L", pack: "Roll of 50", unitPriceCents: 990, vatRate: 21, inStock: 120 },
  { sku: "CP-SPG-10", supplierId: "cleanpro", name: "Scourer sponges", pack: "Pack of 10", unitPriceCents: 450, vatRate: 21, inStock: 150 },
  { sku: "AWS-TON-24", supplierId: "atlantic-wine", name: "Premium tonic 20 cl", pack: "Case of 24", unitPriceCents: 1440, vatRate: 21, inStock: 40 },
  { sku: "AWS-VER-1", supplierId: "atlantic-wine", name: "Vermut rojo", pack: "1 L bottle", unitPriceCents: 1120, vatRate: 21, inStock: 36 },
  { sku: "AWS-RIO-75", supplierId: "atlantic-wine", name: "Rioja Crianza", pack: "75 cl bottle", unitPriceCents: 790, vatRate: 21, inStock: 300 },
  { sku: "AWS-ALB-75", supplierId: "atlantic-wine", name: "Albariño Rías Baixas", pack: "75 cl bottle", unitPriceCents: 940, vatRate: 21, inStock: 180 },
  { sku: "AWS-GIN-70", supplierId: "atlantic-wine", name: "London dry gin", pack: "70 cl bottle", unitPriceCents: 1950, vatRate: 21, inStock: 48 },
  { sku: "AWS-VIC-24", supplierId: "atlantic-wine", name: "Cerveza Victoria 33 cl", pack: "Case of 24", unitPriceCents: 1780, vatRate: 21, inStock: 90 },
  { sku: "AWS-LIM-24", supplierId: "atlantic-wine", name: "Lemon soda 20 cl", pack: "Case of 24", unitPriceCents: 1260, vatRate: 21, inStock: 25 },
];

export const INITIAL_INVENTORY: InventoryItem[] = [
  { key: "cp.degreaser", name: "Heavy-duty degreaser 5 L", unit: "unit", onHand: 1, par: 4, supplierId: "cleanpro", sku: "CP-DEG-5" },
  { key: "cp.dishwash", name: "Dishwasher detergent 20 L", unit: "unit", onHand: 0, par: 2, supplierId: "cleanpro", sku: "CP-DW-20" },
  { key: "cp.rinse", name: "Rinse aid 10 L", unit: "unit", onHand: 1, par: 1, supplierId: "cleanpro", sku: "CP-RA-10" },
  { key: "cp.gloves", name: "Nitrile gloves (box of 100)", unit: "box", onHand: 2, par: 8, supplierId: "cleanpro", sku: "CP-GLV-100" },
  { key: "cp.blueroll", name: "Blue roll (pack of 6)", unit: "pack", onHand: 3, par: 4, supplierId: "cleanpro", sku: "CP-BR-6" },
  { key: "cp.sanitiser", name: "Food-safe sanitiser 750 ml", unit: "unit", onHand: 5, par: 12, supplierId: "cleanpro", sku: "CP-SAN-750" },
  { key: "cp.binbags", name: "Bin bags 120 L (roll of 50)", unit: "roll", onHand: 1, par: 3, supplierId: "cleanpro", sku: "CP-BAG-50" },
  { key: "aw.tonic", name: "Premium tonic 20 cl (case of 24)", unit: "case", onHand: 1, par: 4, supplierId: "atlantic-wine", sku: "AWS-TON-24" },
  { key: "aw.vermut", name: "Vermut rojo 1 L", unit: "bottle", onHand: 2, par: 6, supplierId: "atlantic-wine", sku: "AWS-VER-1" },
  { key: "aw.rioja", name: "Rioja Crianza 75 cl", unit: "bottle", onHand: 30, par: 24, supplierId: "atlantic-wine", sku: "AWS-RIO-75" },
  { key: "aw.gin", name: "London dry gin 70 cl", unit: "bottle", onHand: 5, par: 4, supplierId: "atlantic-wine", sku: "AWS-GIN-70" },
];

export const DEFAULT_SETTINGS = { cashCapCents: 250_000, restockLimitCents: 15_000 };

/** The seven supplier documents waiting in the inbox at the start of the demo. */
export const SAMPLE_FILES = [
  "01-huerta-guadalhorce.png",
  "02-pescados-bahia.png",
  "03-carnicas-sanz.png",
  "04-green-valley-dairy.png",
  "05-atlantic-wine.png",
  "06-cleanpro.png",
  "07-cleanpro-new-payee.png",
];

export function supplierById(id: string | null | undefined): Supplier | undefined {
  return id ? SUPPLIERS.find((s) => s.id === id) : undefined;
}

export function catalogFor(supplierId: string): CatalogItem[] {
  return CATALOG.filter((c) => c.supplierId === supplierId);
}

export function storeSuppliers(): Supplier[] {
  return SUPPLIERS.filter((s) => s.store);
}
