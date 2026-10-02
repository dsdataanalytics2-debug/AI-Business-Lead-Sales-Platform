/**
 * Centralized Date Formatting Utility
 *
 * Enforces explicit 'Asia/Dhaka' timezone for all UI display representations.
 * Handles null/undefined and invalid date strings safely by returning "—".
 */

export function formatDate(
  dateInput?: string | Date | null,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!dateInput) return '—';

  try {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) {
      return '—';
    }

    const defaultOptions: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Dhaka'
    };

    const finalOptions: Intl.DateTimeFormatOptions = options
      ? { timeZone: 'Asia/Dhaka', ...options }
      : defaultOptions;

    return new Intl.DateTimeFormat('en-US', finalOptions).format(date);
  } catch {
    return '—';
  }
}
