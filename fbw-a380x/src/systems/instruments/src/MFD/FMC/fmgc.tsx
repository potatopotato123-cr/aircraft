/* eslint-disable jsx-a11y/label-has-associated-control */

import { FlightPlanService } from '@fmgc/flightplanning/new/FlightPlanService';
import { Fmgc, GuidanceController } from '@fmgc/guidance/GuidanceController';

import { FlapConf } from '@fmgc/guidance/vnav/common';
import { SpeedLimit } from '@fmgc/guidance/vnav/SpeedLimit';
import { FmgcFlightPhase } from '@shared/flightphase';
import { FmcWindVector, FmcWinds } from '@fmgc/guidance/vnav/wind/types';
import { MappedSubject, Subject } from '@microsoft/msfs-sdk';
import { FlightPlanIndex } from '@fmgc/flightplanning/new/FlightPlanManager';
import { Arinc429Word, Knots, Pound, Runway, Units } from '@flybywiresim/fbw-sdk';
import { Feet } from 'msfs-geo';
import { AirlineModifiableInformation } from '@shared/AirlineModifiableInformation';
import { minGw } from '@shared/PerformanceConstants';

export enum TakeoffPowerSetting {
    TOGA = 0,
    FLEX = 1,
    DERATED = 2,
}

export enum TakeoffDerated {
    D01 = 0,
    D02 = 1,
    D03 = 2,
    D04 = 3,
    D05 = 4,
}

export enum TakeoffPacks {
    OFF_APU = 0,
    ON = 1,
}

export enum TakeoffAntiIce {
    OFF = 0,
    ENG_ONLY = 1,
    ENG_WINGS = 2,
}

export enum ClimbDerated {
    NONE = 0,
    D01 = 1,
    D02 = 2,
    D03 = 3,
    D04 = 4,
    D05 = 5,
}

/**
 * Temporary place for data which is found nowhere else. Not associated to flight plans right now, which should be the case for some of these values
 */
export class FmgcData {
    public readonly cpnyFplnAvailable = Subject.create(false);

    public readonly cpnyFplnUplinkInProgress = Subject.create(false);

    public readonly atcCallsign = Subject.create<string>('----------');

    public readonly tripWind = Subject.create<Knots | null>(null);

    public readonly zeroFuelWeight = Subject.create<number | null>(null); // in kg

    public readonly zeroFuelWeightCenterOfGravity = Subject.create<number | null>(null); // in percent

    public readonly blockFuel = Subject.create<number | null>(null); // in kg

    public readonly taxiFuelPilotEntry = Subject.create<number | null>(null); // in kg

    public readonly taxiFuel = this.taxiFuelPilotEntry.map((it) => ((it === null) ? AirlineModifiableInformation.EK.taxiFuel : it)); // in kg

    public readonly taxiFuelIsPilotEntered = this.taxiFuelPilotEntry.map((it) => it !== null);

    public readonly routeReserveFuelWeightPilotEntry = Subject.create<number | null>(null); // in kg

    public readonly routeReserveFuelWeightCalculated = Subject.create<number | null>(null); // in kg

    public readonly routeReserveFuelWeight = MappedSubject.create(([calc, pe]) => (pe !== null ? pe : calc), this.routeReserveFuelWeightCalculated, this.routeReserveFuelWeightPilotEntry);

    public readonly routeReserveFuelPercentagePilotEntry = Subject.create<number | null>(null); // in percent

    public readonly routeReserveFuelPercentage = this.routeReserveFuelPercentagePilotEntry.map((it) => ((it === null) ? AirlineModifiableInformation.EK.rteRsv : it)); // in percent

    public readonly routeReserveFuelIsPilotEntered = MappedSubject.create((
        [fuel, time],
    ) => fuel !== null || time !== null,
    this.routeReserveFuelWeightPilotEntry,
    this.routeReserveFuelPercentagePilotEntry);

    public readonly paxNumber = Subject.create<number | null>(null);

    public readonly jettisonGrossWeight = Subject.create<number | null>(null); // in kg

    public readonly alternateFuelPilotEntry = Subject.create<number | null>(null); // in kg

    public readonly alternateFuelCalculated = Subject.create<number | null>(null); // in kg

    public readonly alternateFuel = MappedSubject.create(([calc, pe]) => (pe !== null ? pe : calc), this.alternateFuelCalculated, this.alternateFuelPilotEntry); // in kg

    public readonly alternateFuelIsPilotEntered = this.alternateFuelPilotEntry.map((it) => it !== null);

    public readonly finalFuelWeightPilotEntry = Subject.create<number | null>(null); // in kg

    public readonly finalFuelWeightCalculated = Subject.create<number | null>(null); // in kg

    public readonly finalFuelWeight = MappedSubject.create(([calc, pe]) => (pe !== null ? pe : calc), this.finalFuelWeightCalculated, this.finalFuelWeightPilotEntry);

    public readonly finalFuelTimePilotEntry = Subject.create<number | null>(null); // in percent

    public readonly finalFuelTime = this.finalFuelTimePilotEntry.map((it) => ((it === null) ? 30 : it)); // in minutes

    public readonly finalFuelIsPilotEntered = MappedSubject.create((
        [fuel, time],
    ) => fuel !== null || time !== null,
    this.finalFuelWeightPilotEntry,
    this.finalFuelTimePilotEntry);

    public readonly minimumFuelAtDestinationPilotEntry = Subject.create<number | null>(null); // in kg

    public readonly minimumFuelAtDestination = MappedSubject.create(
        ([pe, ff, af]) => ((pe === null && ff && af) ? (ff + af) : pe),
        this.minimumFuelAtDestinationPilotEntry,
        this.finalFuelWeight,
        this.alternateFuel,
    ); // in kg

    public readonly minimumFuelAtDestinationIsPilotEntered = this.minimumFuelAtDestinationPilotEntry.map((it) => it !== null);

    /** in feet */
    public readonly tropopausePilotEntry = Subject.create<number | null>(null);

    public readonly tropopause = this.tropopausePilotEntry.map((tp) => (tp ?? 36_090)); // in ft

    public readonly tropopauseIsPilotEntered = this.tropopausePilotEntry.map((it) => it !== null);

    /**
     * For which departure runway the v speeds have been inserted
     */
    public readonly vSpeedsForRunway = Subject.create<string | null>(null);

    /**
     * V1 speed, to be confirmed after rwy change
     */
    readonly v1ToBeConfirmed = Subject.create<Knots | null>(null);

    /**
     * VR speed, to be confirmed after rwy change
     */
    readonly vrToBeConfirmed = Subject.create<Knots | null>(null);

    /**
     * V2 speed, to be confirmed after rwy change
     */
    readonly v2ToBeConfirmed = Subject.create<Knots | null>(null);

    public readonly takeoffFlapsSetting = Subject.create<FlapConf>(FlapConf.CONF_1);

    public readonly approachSpeed = Subject.create<Knots | null>(null);

    public readonly approachWind = Subject.create<FmcWindVector | null>(null);

    public readonly approachQnh = Subject.create<number | null>(null);

    public readonly approachTemperature = Subject.create<number | null>(null);

    public readonly flapRetractionSpeed = Subject.create<Knots | null>(141);

    public readonly slatRetractionSpeed = Subject.create<Knots | null>(159);

    public readonly greenDotSpeed = Subject.create<Knots | null>(190);

    public readonly takeoffShift = Subject.create<number | null>(null); // in meters

    public readonly takeoffPowerSetting = Subject.create<TakeoffPowerSetting>(TakeoffPowerSetting.TOGA);

    public readonly takeoffFlexTemp = Subject.create<number | null>(null);

    public readonly takeoffDeratedSetting = Subject.create<TakeoffDerated | null>(null);

    public readonly takeoffThsFor = Subject.create<number | null>(null);

    public readonly takeoffPacks = Subject.create<TakeoffPacks | null>(TakeoffPacks.ON);

    public readonly takeoffAntiIce = Subject.create<TakeoffAntiIce | null>(TakeoffAntiIce.OFF);

    public readonly noiseEnabled = Subject.create<boolean>(false);

    public readonly noiseN1 = Subject.create<number | null>(null);

    public readonly noiseSpeed = Subject.create<Knots | null>(null);

    /** in feet */
    public readonly noiseEndAltitude = Subject.create<number | null>(null);

    public readonly climbDerated = Subject.create<ClimbDerated | null>(ClimbDerated.NONE);

    /** in feet */
    public readonly climbPredictionsReferencePilotEntry = Subject.create<number | null>(null); // in ft

    /** in feet */
    public readonly climbPredictionsReferenceAutomatic = Subject.create<number | null>(null); // in ft

    public readonly climbPredictionsReference = MappedSubject.create(([calc, pe]) => (pe !== null ? pe : calc),
        this.climbPredictionsReferenceAutomatic,
        this.climbPredictionsReferencePilotEntry);

    public readonly climbPredictionsReferenceIsPilotEntered = this.climbPredictionsReferencePilotEntry.map((it) => it !== null);

    public readonly climbPreSelSpeed = Subject.create<Knots | null>(null);

    public readonly climbSpeedLimit = Subject.create<SpeedLimit>({ speed: 250, underAltitude: 10_000 });

    public readonly cruisePreSelMach = Subject.create<number | null>(null);

    public readonly cruisePreSelSpeed = Subject.create<Knots | null>(null);

    public readonly descentPreSelSpeed = Subject.create<Knots | null>(null);

    public readonly descentSpeedLimit = Subject.create<SpeedLimit>({ speed: 250, underAltitude: 10_000 });

    public readonly descentCabinRate = Subject.create<number>(-350); // ft/min

    /** in feet */
    public readonly approachBaroMinimum = Subject.create<number | null>(null);

    /** in feet */
    public readonly approachRadioMinimum = Subject.create<number | null>(null);

    public readonly approachVref = Subject.create<Knots>(129);

    public readonly approachFlapConfig = Subject.create<FlapConf>(FlapConf.CONF_FULL);

    public readonly approachVls = Subject.create<Knots>(134);

    /**
     * Estimated take-off time, in seconds. Displays as HH:mm:ss
     */
    public readonly estimatedTakeoffTime = Subject.create<number | null>(null);
}

/**
 * Implementation of Fmgc interface. Not associated to flight plans right now, which should be the case for some of these values
 */
export class FmgcDataService implements Fmgc {
    public data = new FmgcData();

    public guidanceController: GuidanceController | undefined = undefined;

    constructor(
        private flightPlanService: FlightPlanService,
    ) {
    }

    getZeroFuelWeight(): Pound {
        // Should be returned in lbs
        const zfw = this.data.zeroFuelWeight.get() ?? minGw;
        return zfw / 1000 * 2204.625;
    }

    /**
     *
     * @returns fuel on board in tonnes (i.e. 1000 x kg)
     */
    getFOB(): number {
        let fob = this.data.blockFuel.get() ?? 0;
        if (this.getFlightPhase() >= FmgcFlightPhase.Takeoff) {
            fob = SimVar.GetSimVarValue('FUEL TOTAL QUANTITY', 'gallons') * SimVar.GetSimVarValue('FUEL WEIGHT PER GALLON', 'kilograms');
        }

        return fob / 1_000; // Needs to be returned in tonnes
    }

    getV2Speed(): Knots {
        return this.flightPlanService.has(FlightPlanIndex.Active) ? this.flightPlanService.active.performanceData.v2 : 150;
    }

    getTropoPause(): Feet {
        return this.data.tropopause.get();
    }

    getManagedClimbSpeed(): Knots {
        if (this.flightPlanService.has(FlightPlanIndex.Active)) {
            const dCI = ((this.flightPlanService.active.performanceData.costIndex ?? 100) / 999) ** 2;
            return 290 * (1 - dCI) + 330 * dCI;
        }
        return 250;
    }

    getManagedClimbSpeedMach(): number {
        /* // Assume FL270 as crossover point
        const pressure = AeroMath.isaPressure(UnitType.METER.convertFrom(27_000, UnitType.FOOT));
        const mach = AeroMath.casToMach(UnitType.MPS.convertFrom(this.getManagedClimbSpeed(), UnitType.KNOT), pressure);
        return mach; */
        // Return static mach number for now, ECON speed calculation is not mature enough
        return 0.80;
    }

    getAccelerationAltitude(): Feet {
        return this.flightPlanService.has(FlightPlanIndex.Active) ? this.flightPlanService?.active.performanceData.accelerationAltitude as Feet : 1_500;
    }

    getThrustReductionAltitude(): Feet {
        return this.flightPlanService.has(FlightPlanIndex.Active) ? this.flightPlanService?.active.performanceData.thrustReductionAltitude as Feet : 1_500;
    }

    getOriginTransitionAltitude(): Feet | undefined {
        return this.flightPlanService.has(FlightPlanIndex.Active) ? this.flightPlanService?.active.performanceData.transitionAltitude as Feet : undefined;
    }

    getDestinationTransitionLevel(): Feet | undefined {
        return this.flightPlanService.has(FlightPlanIndex.Active) ? this.flightPlanService?.active.performanceData.transitionLevel as Feet : undefined;
    }

    /**
     *
     * @returns flight level in steps of 100ft (e.g. 320 instead of 32000 for FL320)
     */
    getCruiseAltitude(): Feet {
        return this.flightPlanService.has(FlightPlanIndex.Active) ? this.flightPlanService?.active.performanceData.cruiseFlightLevel : 320;
    }

    getFlightPhase(): FmgcFlightPhase {
        return SimVar.GetSimVarValue('L:A32NX_FMGC_FLIGHT_PHASE', 'Enum');
    }

    getManagedCruiseSpeed(): Knots {
        const preSel = this.data.cruisePreSelSpeed.get();
        if (Number.isFinite(preSel) && preSel !== null) {
            return preSel;
        }

        if (this.flightPlanService.has(FlightPlanIndex.Active)) {
            const dCI = ((this.flightPlanService.active.performanceData.costIndex ?? 100) / 999) ** 2;
            return 290 * (1 - dCI) + 310 * dCI;
        }
        return 310;
    }

    getManagedCruiseSpeedMach(): number {
        /* const pressure = AeroMath.isaPressure(UnitType.METER.convertFrom(this.getCruiseAltitude() * 100, UnitType.FOOT));
        const mach = AeroMath.casToMach(UnitType.MPS.convertFrom(this.getManagedCruiseSpeed(), UnitType.KNOT), pressure);
        return mach; */
        // Return static mach number for now, ECON speed calculation is not mature enough
        return this.data.cruisePreSelMach.get() ?? 0.82;
    }

    getClimbSpeedLimit(): SpeedLimit {
        return { speed: 250, underAltitude: 10_000 };
    }

    getDescentSpeedLimit(): SpeedLimit {
        return { speed: 250, underAltitude: 10_000 };
    }

    getPreSelectedClbSpeed(): Knots {
        // FIXME fmgc interface should also accept null
        return this.data.climbPreSelSpeed.get() ?? 0;
    }

    getPreSelectedCruiseSpeed(): Knots {
        // FIXME fmgc interface should also accept null
        return this.data.cruisePreSelSpeed.get() ?? 0;
    }

    getPreSelectedDescentSpeed(): Knots {
        // FIXME fmgc interface should also accept null
        return this.data.descentPreSelSpeed.get() ?? 0;
    }

    getTakeoffFlapsSetting(): FlapConf | undefined {
        return this.data.takeoffFlapsSetting.get();
    }

    getManagedDescentSpeed(): Knots {
        if (Number.isFinite(this.data.descentPreSelSpeed.get())) {
            return this.data.descentPreSelSpeed.get() ?? 0;
        }
        // TODO adapt for A380
        if (this.flightPlanService.has(FlightPlanIndex.Active)) {
            const dCI = (this.flightPlanService.active.performanceData.costIndex ?? 100) / 999;
            return 288 * (1 - dCI) + 300 * dCI;
        }
        return 300;
    }

    getManagedDescentSpeedMach(): number {
        /* // Assume FL270 as crossover point
        const pressure = AeroMath.isaPressure(UnitType.METER.convertFrom(27_000, UnitType.FOOT));
        const mach = AeroMath.casToMach(UnitType.MPS.convertFrom(this.getManagedClimbSpeed(), UnitType.KNOT), pressure);
        return mach; */
        // Return static mach number for now, ECON speed calculation is not mature enough
        return 0.80;
    }

    getApproachSpeed(): Knots {
        return this.data.approachSpeed.get() ?? 0;
    }

    getFlapRetractionSpeed(): Knots {
        return this.data.flapRetractionSpeed.get() ?? 0;
    }

    getSlatRetractionSpeed(): Knots {
        return this.data.slatRetractionSpeed.get() ?? 0;
    }

    getCleanSpeed(): Knots {
        return this.data.greenDotSpeed.get() ?? 0;
    }

    getTripWind(): number {
        return this.data.tripWind.get() ?? 0;
    }

    getWinds(): FmcWinds {
        return { climb: [{ direction: 0, speed: 0 }], cruise: [{ direction: 0, speed: 0 }], des: [{ direction: 0, speed: 0 }], alternate: null };
    }

    getApproachWind(): FmcWindVector {
        return this.data.approachWind.get() ?? { direction: 0, speed: 0 };
    }

    getApproachQnh(): number {
        return this.data.approachQnh.get() ?? 1013.15;
    }

    getApproachTemperature(): number {
        return this.data.approachTemperature.get() ?? 0;
    }

    getDestEFOB(useFob: boolean): number { // Metric tons
        const efob = this.guidanceController?.vnavDriver?.getDestinationPrediction()?.estimatedFuelOnBoard; // in Pounds
        if (useFob === true && efob !== undefined) {
            return Units.poundToKilogram(efob) / 1000.0;
        }
        return 0;
    }

    getAltEFOB(useFOB = false) {
        // TODO estimate alternate fuel
        if (this.getDestEFOB(useFOB) === 0) {
            return 0;
        }
        return (this.getDestEFOB(useFOB) - 1.0) > 0 ? this.getDestEFOB(useFOB) - 1.0 : 0;
    }

    getDepartureElevation(): Feet | null {
        return this.flightPlanService.has(FlightPlanIndex.Active) ? this.flightPlanService?.active?.originRunway?.thresholdLocation?.alt : null;
    }

    getDestinationElevation(): Feet {
        return this.flightPlanService.has(FlightPlanIndex.Active) ? this.flightPlanService?.active?.destinationRunway?.thresholdLocation?.alt : 0;
    }

    getDestinationRunway(): Runway | null {
        return this.flightPlanService.has(FlightPlanIndex.Active) ? this.flightPlanService?.active?.destinationRunway : null;
    }

    getDistanceToDestination(): number | null {
        return this.guidanceController?.vnavDriver.getDestinationPrediction()?.distanceFromAircraft ?? null;
    }

    getNavDataDateRange(): string {
        return SimVar.GetGameVarValue('FLIGHT NAVDATA DATE RANGE', 'string');
    }

    /**
     * Generic function which returns true if engine(index) is ON (N2 > 20)
     * @returns {boolean}
     */
    public isEngineOn(index: number): boolean {
        return SimVar.GetSimVarValue(`L:A32NX_ENGINE_N2:${index}`, 'number') > 20;
    }

    /**
     * Returns true if any one engine is running (N2 > 20)
     */
    public isAnEngineOn(): boolean {
        return this.isEngineOn(1) || this.isEngineOn(2) || this.isEngineOn(3) || this.isEngineOn(4);
    }

    /**
     * Returns true only if all engines are running (N2 > 20 for inner engines)
     */
    isAllEngineOn(): boolean {
        return this.isEngineOn(2) && this.isEngineOn(3);
    }

    isOnGround() {
        return SimVar.GetSimVarValue('L:A32NX_LGCIU_1_NOSE_GEAR_COMPRESSED', 'Number') === 1 || SimVar.GetSimVarValue('L:A32NX_LGCIU_2_NOSE_GEAR_COMPRESSED', 'Number') === 1;
    }

    isFlying() {
        return this.getFlightPhase() >= FmgcFlightPhase.Takeoff && this.getFlightPhase() < FmgcFlightPhase.Done;
    }

    getPressureAltAtElevation(elev: number, qnh = 1013.2) {
        const p0 = qnh < 500 ? 29.92 : 1013.2;
        return elev + 145442.15 * (1 - ((qnh / p0) ** 0.190263));
    }

    getPressureAlt() {
        for (let n = 1; n <= 3; n++) {
            const zp = Arinc429Word.fromSimVarValue(`L:A32NX_ADIRS_ADR_${n}_ALTITUDE`);
            if (zp.isNormalOperation()) {
                return zp.value;
            }
        }
        return null;
    }

    getBaroCorrection1(): number {
        // FIXME hook up to ADIRU or FCU
        return Simplane.getPressureValue('millibar') ?? 1013.25;
    }
}
