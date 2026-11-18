import { Enum } from '@/util/enum'
import { packStatus, type Status, type TemperatureUnit } from './fridge_common'
import Dev_2REF11EII__M2, { FREEZER_F, FRIDGE_F, SETTING_LEN } from './2REF11EII__M2'

// 2REF12EII_P_2 - LG French door refrigerator with dispenser, sold in Australia
// (model JSON: "T20_Next8 Dispenser AU Wi-Fi", deviceType 101, QCA4010 modem).
//
// Same 9-byte status block, 10EB/10EC/10A8 frames and F017 settings as 2REF11EII__M2.
// The differences, checked on a live unit in Celsius:
// * Setpoints are this model's own model-JSON indices: fridge 1..7 is 6..0 C, freezer
//   1..9 is -16..-24 C. The Fahrenheit tables match 2REF11EII__M2's.
// * Fresh air filter Off is a real mode: writing 1 sets it and the status reports it back.
// * Settings leave every field they don't change at 0xFF, the form tested on this unit,
//   rather than copying the zeroed dispenser fields of 2REF11EII__M2's cloud captures.
//   The status block stops before the dispenser fields, so a write there can't be read back.

const FRIDGE_C = new Map([
    [1, 6],
    [2, 5],
    [3, 4],
    [4, 3],
    [5, 2],
    [6, 1],
    [7, 0],
])
const FREEZER_C = new Map([
    [1, -16],
    [2, -17],
    [3, -18],
    [4, -19],
    [5, -20],
    [6, -21],
    [7, -22],
    [8, -23],
    [9, -24],
])

const FRESH_AIR_MODES = Enum.of({ Off: 1, Auto: 2, Power: 3 })

export default class Device extends Dev_2REF11EII__M2 {
    protected tables(unit: TemperatureUnit) {
        return unit === 'F' ? { fridge: FRIDGE_F, freezer: FREEZER_F } : { fridge: FRIDGE_C, freezer: FREEZER_C }
    }

    protected freshAirModes(): Enum<string> {
        return FRESH_AIR_MODES
    }

    protected buildSetting(setting: Partial<Status>) {
        return Buffer.concat([Buffer.from('F017', 'hex'), packStatus(setting, SETTING_LEN)])
    }
}
