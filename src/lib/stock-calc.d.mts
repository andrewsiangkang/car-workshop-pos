export type StockLine = { type: string; quantity: number; inventoryItemId?: string | null };
export type StockMove = { inventoryItemId: string; quantity: number };
export type StockPlanRow = {
  inventoryItemId: string;
  name: string;
  sku: string | null;
  needed: number;
  alreadyTaken: number;
  outstanding: number;
  onHand: number;
  short: number;
};
export function roundQty(n: number): number;
export function neededByItem(items: StockLine[]): Map<string, number>;
export function takenByItem(movements: StockMove[]): Map<string, number>;
export function planInvoiceStock(
  items: StockLine[],
  movements: StockMove[],
  inventory: Array<{ id: string; quantityOnHand: number; name?: string; sku?: string | null }>
): StockPlanRow[];
export function returnableQty(movements: StockMove[], inventoryItemId: string): number;
export function stockChangeAllowed(onHand: number, delta: number): boolean;
