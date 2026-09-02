import { describe, expect, it } from "vitest";
import type { AttributeBinding } from "../shared/types.js";
import {
  decodeMqttValue,
  encodeMqttValue,
  hsvToRgb,
  kelvinToMired,
  miredToKelvin,
  parseRgb,
  rgbToHsv,
  rgbToXy,
  xyToRgb,
} from "./converters.js";

describe("MQTT value converters", () => {
  it("decodes and encodes inverted booleans", () => {
    const binding: AttributeBinding = { stateTopic: "/state", commandTopic: "/set", valueType: "boolean", converter: { invert: true, trueValue: "ON", falseValue: "OFF" } };
    expect(decodeMqttValue("ON", binding)).toBe(false);
    expect(encodeMqttValue(false, binding)).toBe("ON");
  });

  it("applies scale and offset in both directions", () => {
    const binding: AttributeBinding = { stateTopic: "/state", valueType: "number", converter: { scale: 0.1, offset: -2 } };
    expect(decodeMqttValue("220", binding)).toBe(20);
    expect(encodeMqttValue(20, binding)).toBe("220");
  });

  it("parses the WB R;G;B format", () => {
    expect(parseRgb("255;12;0")).toEqual({ r: 255, g: 12, b: 0 });
    expect(() => parseRgb("#ff0000")).toThrow(/R;G;B/);
  });

  it("converts RGB through HSV and XY", () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ hue: 0, saturation: 100, value: 100 });
    expect(hsvToRgb(120, 100, 100)).toEqual({ r: 0, g: 255, b: 0 });
    const xy = rgbToXy({ r: 32, g: 140, b: 210 });
    const roundTrip = xyToRgb(xy.x, xy.y, 82);
    expect(roundTrip.b).toBeGreaterThan(roundTrip.r);
    expect(roundTrip.b).toBeGreaterThan(roundTrip.g);
  });

  it("converts Kelvin and mired", () => {
    expect(kelvinToMired(4000)).toBe(250);
    expect(miredToKelvin(250)).toBe(4000);
  });
});
