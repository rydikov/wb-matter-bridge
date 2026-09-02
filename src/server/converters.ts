import type { AttributeBinding } from "../shared/types.js";

export interface RgbValue { r: number; g: number; b: number }

export function decodeMqttValue(raw: string, binding: AttributeBinding): boolean | number | string | RgbValue {
  const converter = binding.converter ?? {};
  switch (binding.valueType) {
    case "boolean": {
      const trueValue = converter.trueValue ?? "1";
      const falseValue = converter.falseValue ?? "0";
      if (raw !== trueValue && raw !== falseValue) throw new Error(`Ожидалось ${trueValue} или ${falseValue}`);
      const value = raw === trueValue;
      return converter.invert ? !value : value;
    }
    case "number": {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) throw new Error("Ожидалось число");
      const value = clamp(parsed * (converter.scale ?? 1) + (converter.offset ?? 0), converter.min, converter.max);
      return converter.invert && converter.min !== undefined && converter.max !== undefined
        ? converter.max - (value - converter.min)
        : value;
    }
    case "enum": {
      return converter.enum?.[raw] ?? raw;
    }
    case "rgb":
      return parseRgb(raw);
  }
}

export function encodeMqttValue(value: unknown, binding: AttributeBinding): string {
  const converter = binding.converter ?? {};
  switch (binding.valueType) {
    case "boolean": {
      let booleanValue = Boolean(value);
      if (converter.invert) booleanValue = !booleanValue;
      return booleanValue ? (converter.trueValue ?? "1") : (converter.falseValue ?? "0");
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Ожидалось число");
      let converted = value;
      if (converter.invert && converter.min !== undefined && converter.max !== undefined) {
        converted = converter.max - (converted - converter.min);
      }
      converted = (converted - (converter.offset ?? 0)) / (converter.scale ?? 1);
      return formatNumber(converted);
    }
    case "enum": {
      const entry = Object.entries(converter.enum ?? {}).find(([, mapped]) => mapped === value);
      return entry?.[0] ?? String(value);
    }
    case "rgb": {
      const rgb = value as RgbValue;
      return `${toByte(rgb.r)};${toByte(rgb.g)};${toByte(rgb.b)}`;
    }
  }
}

export function parseRgb(raw: string): RgbValue {
  const parts = raw.split(";").map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error("Ожидался RGB в формате R;G;B");
  }
  return { r: parts[0], g: parts[1], b: parts[2] };
}

export function rgbToHsv({ r, g, b }: RgbValue): { hue: number; saturation: number; value: number } {
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === nr) hue = 60 * (((ng - nb) / delta) % 6);
    else if (max === ng) hue = 60 * ((nb - nr) / delta + 2);
    else hue = 60 * ((nr - ng) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { hue, saturation: max === 0 ? 0 : (delta / max) * 100, value: max * 100 };
}

export function hsvToRgb(hue: number, saturation: number, value: number): RgbValue {
  const c = (value / 100) * (saturation / 100);
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = value / 100 - c;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return { r: toByte((r + m) * 255), g: toByte((g + m) * 255), b: toByte((b + m) * 255) };
}

export function rgbToXy({ r, g, b }: RgbValue): { x: number; y: number } {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value > 0.04045 ? ((value + 0.055) / 1.055) ** 2.4 : value / 12.92;
  };
  const lr = linear(r);
  const lg = linear(g);
  const lb = linear(b);
  const X = lr * 0.664511 + lg * 0.154324 + lb * 0.162028;
  const Y = lr * 0.283881 + lg * 0.668433 + lb * 0.047685;
  const Z = lr * 0.000088 + lg * 0.07231 + lb * 0.986039;
  const sum = X + Y + Z;
  return sum === 0 ? { x: 0, y: 0 } : { x: X / sum, y: Y / sum };
}

export function xyToRgb(x: number, y: number, brightness = 100): RgbValue {
  if (y <= 0) return { r: 0, g: 0, b: 0 };
  const Y = Math.min(1, Math.max(0, brightness / 100));
  const X = (Y / y) * x;
  const Z = (Y / y) * (1 - x - y);
  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - Y * 0.121364 + Z * 1.01153;
  const gamma = (channel: number) => channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
  r = gamma(Math.max(0, r));
  g = gamma(Math.max(0, g));
  b = gamma(Math.max(0, b));
  const max = Math.max(r, g, b, 1);
  return { r: toByte((r / max) * 255), g: toByte((g / max) * 255), b: toByte((b / max) * 255) };
}

export function toMatterTemperature(celsius: number): number { return Math.round(celsius * 100); }
export function fromMatterTemperature(value: number): number { return value / 100; }
export function toMatterPercent(value: number): number { return Math.round(clamp(value, 0, 100) * 100); }
export function fromMatterPercent(value: number): number { return value / 100; }
export function kelvinToMired(kelvin: number): number { return Math.round(1_000_000 / kelvin); }
export function miredToKelvin(mired: number): number { return Math.round(1_000_000 / mired); }

function clamp(value: number, min?: number, max?: number): number {
  return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, value));
}

function toByte(value: number): number { return Math.round(Math.min(255, Math.max(0, value))); }
function formatNumber(value: number): string { return Number(value.toFixed(6)).toString(); }
