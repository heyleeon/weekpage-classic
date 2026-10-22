// en · holidays — typed against the zh-Hans twin: a missing or extra key fails tsc.

import type { Messages } from "../../types";
import type zh from "../zh-Hans/holidays";

const holidays: Messages<typeof zh> = {
  workday: "Workday",
  nthDay: "{{name}} · {{n}}",
  withTerm: "{{head}} · {{term}}",
  festival: {
    newYear: { full: "New Year's Day", short: "New Year" },
    springFestival: { full: "Spring Festival", short: "Spring Festival" },
    qingming: { full: "Qingming Festival", short: "Qingming" },
    labourDay: { full: "Labour Day", short: "May Day" },
    dragonBoat: { full: "Dragon Boat Festival", short: "Dragon Boat" },
    midAutumn: { full: "Mid-Autumn Festival", short: "Mid-Autumn" },
    nationalDay: { full: "National Day", short: "National Day" },
  },
  term: {
    minorCold: "Minor Cold",
    majorCold: "Major Cold",
    springBegins: "Start of Spring",
    rainWater: "Rain Water",
    insectsAwaken: "Insects Awaken",
    springEquinox: "Spring Equinox",
    pureBrightness: "Pure Brightness",
    grainRain: "Grain Rain",
    summerBegins: "Start of Summer",
    grainBuds: "Grain Buds",
    grainInEar: "Grain in Ear",
    summerSolstice: "Summer Solstice",
    minorHeat: "Minor Heat",
    majorHeat: "Major Heat",
    autumnBegins: "Start of Autumn",
    endOfHeat: "End of Heat",
    whiteDew: "White Dew",
    autumnEquinox: "Autumn Equinox",
    coldDew: "Cold Dew",
    frostDescent: "Frost's Descent",
    winterBegins: "Start of Winter",
    minorSnow: "Minor Snow",
    majorSnow: "Major Snow",
    winterSolstice: "Winter Solstice",
  },
};

export default holidays;
