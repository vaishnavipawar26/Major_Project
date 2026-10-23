// The one place the recommendation form's example buttons are defined. Each example fills every input of the form
// with values that suit its crop (checked against the crop's usual ranges in cropExamples.test.js). The button text is
// built by `exampleLabel` from the example's own city and months (no crop name); `crop` is only a tag for the range checks in the tests.
import { cropName, monthShort } from "../utils/format";

export const CROP_EXAMPLES = [
  { crop: "Wheat", city: "Nagpur", soil_type: "clay_loam", area_acres: 2, planting_month: 11, selling_month: 3,
    nitrogen: 90, phosphorus: 45, potassium: 45, ph: 7.2, temperature: 19, humidity: 45, rainfall: 25 },
  { crop: "Onion", city: "Nashik", soil_type: "loam", area_acres: 1, planting_month: 11, selling_month: 3,
    nitrogen: 80, phosphorus: 45, potassium: 85, ph: 6.8, temperature: 23, humidity: 58, rainfall: 70 },
  { crop: "Cabbage", city: "Pune", soil_type: "sandy_loam", area_acres: 1, planting_month: 10, selling_month: 1,
    nitrogen: 115, phosphorus: 60, potassium: 75, ph: 6.3, temperature: 21, humidity: 70, rainfall: 90 },
  { crop: "Potato", city: "Ahilyanagar", soil_type: "sandy_loam", area_acres: 1, planting_month: 10, selling_month: 2,
    nitrogen: 120, phosphorus: 85, potassium: 135, ph: 5.8, temperature: 19, humidity: 68, rainfall: 60 },
];

/** The example the "Fill sample values" link uses. */
export const DEFAULT_EXAMPLE = CROP_EXAMPLES[1];

/** Button text "<City> · <planting month> → <selling month>", read from the example's own values so it always matches what the button fills in. */
export const exampleLabel = (ex, t) =>
  t("crop.form.exampleLabel", { city: cropName(t, ex.city, "city"), from: monthShort(ex.planting_month), to: monthShort(ex.selling_month) });

/** An example as form state: everything except the `crop` tag, as strings (what the inputs hold). */
export const exampleToForm = ({ crop, ...values }) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));
