import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatMyDate, formatMyDateTime, myDateKey } from "@/lib/money-time.mjs"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('zh-MY', {
    style: 'currency',
    currency: 'MYR',
    minimumFractionDigits: 2,
  }).format(amount)
}

// Dates are printed on the Malaysian calendar (UTC+8) whatever time zone the PC is set to,
// like document numbers (money-time.mjs). Same "YYYY/MM/DD" and "YYYY/MM/DD HH:mm" look as before.
// 【中文】日期一律按马来西亚时间显示，不受电脑时区影响；格式和以前一样。
export function formatDate(date: Date | string) {
  return formatMyDate(date)
}

export function formatDateTime(date: Date | string) {
  return formatMyDateTime(date)
}

export function generateOrderNumber() {
  const datePart = myDateKey(new Date()).replace(/-/g, '')
  const random = Math.floor(Math.random() * 9000 + 1000)
  return `WO${datePart}${random}`
}
