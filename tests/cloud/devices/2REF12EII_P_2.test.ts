import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import DUT from '@/cloud/devices/2REF12EII_P_2'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq2Device, buf, hex } from '@/tests/helpers/mocks'

const DEVICE_ID = 'test-id'
const MODEL_ID = '2REF12EII_P_2'
const META: Metadata = { modelId: MODEL_ID, modelName: '2REF12EII_P_2', swVersion: 'clip_hna_v1.9.230' }

// Captured from a live 2REF12EII_P_2 (AU, Celsius). The LG cloud reported the same state
// beforehand: fridge 3 C, freezer -18 C, express off, fresh air off, smart grid delay
// defrost, water filter 6 months, doors closed.
const CLOUD_CMD_START_QUERY = buf('AA0EF0ED1211010000010400EBBB')
const SAMPLE_INITIAL = buf('AA0F10EB0204030101020600019DBB')

// Each command below was sent to the unit, acknowledged with 1000 17 00, and applied in the
// 10EC that followed.
const CMD_EXPRESS_ON = buf(
    'AA2FF017FFFFFF02FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFBB',
)
const DELTA_EXPRESS_ON = buf('AA1810EC020403010102060001020403020102060001B2BB')
const CMD_EXPRESS_OFF = buf(
    'AA2FF017FFFFFF01FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFECBB',
)
const DELTA_EXPRESS_OFF = buf('AA1810EC020403020102060001020403010102060001B2BB')

const CMD_FRIDGE_2C = buf(
    'AA2FF017FF05FFFFFFFFFFFF01FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEABB',
)
const DELTA_FRIDGE_2C = buf('AA1810EC020403010102060001020503010102060001B2BB')
const CMD_FRIDGE_3C = buf(
    'AA2FF017FF04FFFFFFFFFFFF01FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBBB',
)

const CMD_FREEZER_M19C = buf(
    'AA2FF017FFFF04FFFFFFFFFF01FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBBB',
)
const DELTA_FREEZER_M19C = buf('AA1810EC020403010102060001020404010102060001B2BB')
const CMD_FREEZER_M18C = buf(
    'AA2FF017FFFF03FFFFFFFFFF01FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFE8BB',
)

const CMD_FRESH_AIR_AUTO = buf(
    'AA2FF017FFFFFFFF02FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFBB',
)
const DELTA_FRESH_AIR_AUTO = buf('AA1810EC020403010102060001020403010202060001B2BB')
const DELTA_FRESH_AIR_POWER = buf('AA1810EC020403010202060001020403010302060001BCBB')
const CMD_FRESH_AIR_OFF = buf(
    'AA2FF017FFFFFFFF01FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFECBB',
)
const DELTA_FRESH_AIR_OFF = buf('AA1810EC020403010302060001020403010102060001BDBB')

const CMD_SMART_GRID_OFF = buf(
    'AA2FF017FFFFFFFFFF00FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEDBB',
)
const DELTA_SMART_GRID_OFF = buf('AA1810EC020403010102060001020403010100060001B1BB')
const DELTA_SMART_GRID_SEASONAL = buf('AA1810EC020403010100060001020403010102060001B1BB')

// Opening and closing each door in turn. 10A8 reports a compartment (01 fridge, 02 freezer),
// not which of its two doors, and each event comes with a 10EC flipping the any-door-open byte.
const FRIDGE_DOOR_OPEN = buf('AA0810A8010139BB')
const FRIDGE_DOOR_CLOSED = buf('AA0810A801003EBB')
const FREEZER_DOOR_OPEN = buf('AA0810A8020138BB')
const FREEZER_DOOR_CLOSED = buf('AA0810A8020039BB')
const DELTA_DOOR_OPEN = buf('AA1810EC020403010102060001020403010102060101B2BB')
const DELTA_DOORS_CLOSED = buf('AA1810EC020403010102060101020403010102060001B2BB')

function makeDevice() {
    const ha = new MockHAConnection()
    const thinq = new MockThinq2Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    return { ha, thinq, dev }
}

function components(ha: MockHAConnection) {
    return ha.devices[DEVICE_ID].config!.components as Record<string, Record<string, unknown>>
}

describe(MODEL_ID, () => {
    test('start() sends the query the unit answers with 10EB', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()

        dev.start()
        assert.equal(hex(thinq.outbox[0]), hex(CLOUD_CMD_START_QUERY))
    })

    test('10EB initial status decodes to the state the LG cloud reported', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_INITIAL)

        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.fridge_setpoint, 3) // raw 4
        assert.equal(props.freezer_setpoint, -18) // raw 3
        assert.equal(props.express_freeze, 'OFF')
        assert.equal(props.fresh_air_filter, 'Off') // raw 1
        assert.equal(props.fresh_air_filter_replace, 'OFF')
        assert.equal(props.smart_grid, 'Seasonal Energy Saver') // raw 2, delay defrost
        assert.equal(props.water_filter, 'ON') // 6 months: replace
        assert.equal(props.water_filter_months, 6)
        assert.equal(props.fridge_door, 'OFF')
        assert.equal(props.freezer_door, 'OFF')
    })

    test("Celsius ranges come from this model's tables", () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_INITIAL)

        const c = components(ha)
        assert.equal(c.fridge_setpoint.unit_of_measurement, '°C')
        assert.equal(c.fridge_setpoint.min, 0)
        assert.equal(c.fridge_setpoint.max, 6)
        assert.equal(c.freezer_setpoint.min, -24)
        assert.equal(c.freezer_setpoint.max, -16)
        assert.deepEqual(c.fresh_air_filter.options, ['Off', 'Auto', 'Power'])
    })

    test("entities use this model's LG names", () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_INITIAL)

        const c = components(ha)
        assert.equal(c.express_freeze.name, 'Express Freeze')
        assert.equal(c.fresh_air_filter.name, 'Pure N Fresh')
        assert.equal(c.fresh_air_filter_replace.name, 'Pure N Fresh filter health')
    })

    test('setpoint changes read back through 10EC', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', DELTA_FRIDGE_2C)
        assert.equal(ha.devices[DEVICE_ID].properties.fridge_setpoint, 2) // raw 5

        thinq.emit('data', DELTA_FREEZER_M19C)
        assert.equal(ha.devices[DEVICE_ID].properties.freezer_setpoint, -19) // raw 4
    })

    test('setpoint writes reproduce the commands the unit accepted', () => {
        const { thinq, dev } = makeDevice()
        thinq.emit('data', SAMPLE_INITIAL) // establish Celsius

        const sent = (prop: string, value: string) => {
            thinq.resetRecorder()
            dev.setProperty(prop, value)
            return hex(thinq.outbox[0])
        }
        assert.equal(sent('fridge_setpoint', '2'), hex(CMD_FRIDGE_2C))
        assert.equal(sent('fridge_setpoint', '3'), hex(CMD_FRIDGE_3C))
        assert.equal(sent('freezer_setpoint', '-19'), hex(CMD_FREEZER_M19C))
        assert.equal(sent('freezer_setpoint', '-18'), hex(CMD_FREEZER_M18C))
    })

    test('express freeze reads back and writes as captured', () => {
        const { ha, thinq, dev } = makeDevice()
        thinq.emit('data', DELTA_EXPRESS_ON)
        assert.equal(ha.devices[DEVICE_ID].properties.express_freeze, 'ON')
        thinq.emit('data', DELTA_EXPRESS_OFF)
        assert.equal(ha.devices[DEVICE_ID].properties.express_freeze, 'OFF')

        thinq.resetRecorder()
        dev.setProperty('express_freeze', 'ON')
        assert.equal(hex(thinq.outbox[0]), hex(CMD_EXPRESS_ON))
        thinq.resetRecorder()
        dev.setProperty('express_freeze', 'OFF')
        assert.equal(hex(thinq.outbox[0]), hex(CMD_EXPRESS_OFF))
    })

    test('fresh air filter Off is a mode that reads back and can be set', () => {
        const { ha, thinq, dev } = makeDevice()
        const props = () => ha.devices[DEVICE_ID].properties

        thinq.emit('data', DELTA_FRESH_AIR_AUTO)
        assert.equal(props().fresh_air_filter, 'Auto') // raw 2
        thinq.emit('data', DELTA_FRESH_AIR_POWER)
        assert.equal(props().fresh_air_filter, 'Power') // raw 3
        thinq.emit('data', DELTA_FRESH_AIR_OFF)
        assert.equal(props().fresh_air_filter, 'Off') // raw 1

        thinq.resetRecorder()
        dev.setProperty('fresh_air_filter', 'Off')
        assert.equal(hex(thinq.outbox[0]), hex(CMD_FRESH_AIR_OFF))
        thinq.resetRecorder()
        dev.setProperty('fresh_air_filter', 'Auto')
        assert.equal(hex(thinq.outbox[0]), hex(CMD_FRESH_AIR_AUTO))
    })

    test('smart grid uses the same codes as 2REF11EII__M2', () => {
        const { ha, thinq, dev } = makeDevice()
        thinq.emit('data', DELTA_SMART_GRID_OFF)
        assert.equal(ha.devices[DEVICE_ID].properties.smart_grid, 'Not In Use')
        thinq.emit('data', DELTA_SMART_GRID_SEASONAL)
        assert.equal(ha.devices[DEVICE_ID].properties.smart_grid, 'Seasonal Energy Saver')

        thinq.resetRecorder()
        dev.setProperty('smart_grid', 'Not In Use')
        assert.equal(hex(thinq.outbox[0]), hex(CMD_SMART_GRID_OFF))
    })

    test('10A8 gives per-compartment door state', () => {
        const { ha, thinq } = makeDevice()
        const props = () => ha.devices[DEVICE_ID].properties

        thinq.emit('data', FRIDGE_DOOR_OPEN)
        thinq.emit('data', DELTA_DOOR_OPEN)
        assert.equal(props().fridge_door, 'ON')
        assert.equal(props().freezer_door, undefined, 'freezer untouched')
        thinq.emit('data', FRIDGE_DOOR_CLOSED)
        assert.equal(props().fridge_door, 'OFF')

        thinq.emit('data', FREEZER_DOOR_OPEN)
        assert.equal(props().freezer_door, 'ON')
        thinq.emit('data', FREEZER_DOOR_CLOSED)
        assert.equal(props().freezer_door, 'OFF')
    })

    test('a 10EC reporting every door closed resynchronises both compartments', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', FRIDGE_DOOR_OPEN)
        thinq.emit('data', FREEZER_DOOR_OPEN)

        thinq.emit('data', DELTA_DOORS_CLOSED)
        assert.equal(ha.devices[DEVICE_ID].properties.fridge_door, 'OFF')
        assert.equal(ha.devices[DEVICE_ID].properties.freezer_door, 'OFF')
    })

    test('setting acks, 1072 and 10AF frames are ignored without warnings', () => {
        const { ha, thinq } = makeDevice()
        const warnings: unknown[] = []
        const original = console.warn
        console.warn = (...args: unknown[]) => warnings.push(args)
        try {
            thinq.emit('data', buf('AA08100017008CBB'))
            thinq.emit('data', buf('AA13107200010A000000000000000000001FBB'))
            thinq.emit('data', buf('AA0B10AF1400000403DABB'))
        } finally {
            console.warn = original
        }
        assert.deepEqual(warnings, [])
        assert.equal(ha.devices[DEVICE_ID]?.config, undefined)
    })
})
