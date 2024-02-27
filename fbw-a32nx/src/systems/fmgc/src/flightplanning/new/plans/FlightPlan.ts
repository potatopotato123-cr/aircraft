// Copyright (c) 2021-2022 FlyByWire Simulations
// Copyright (c) 2021-2022 Synaptic Simulations
//
// SPDX-License-Identifier: GPL-3.0

import { Airport, ApproachType, Fix, LegType, MathUtils, NXDataStore } from '@flybywiresim/fbw-sdk';
import { AlternateFlightPlan } from '@fmgc/flightplanning/new/plans/AlternateFlightPlan';
import { EventBus, MagVar } from '@microsoft/msfs-sdk';
import { FixInfoData, FixInfoEntry } from '@fmgc/flightplanning/new/plans/FixInfo';
import { loadAllDepartures, loadAllRunways } from '@fmgc/flightplanning/new/DataLoading';
import { Coordinates, Degrees } from 'msfs-geo';
import { FlightPlanLeg, FlightPlanLegFlags } from '@fmgc/flightplanning/new/legs/FlightPlanLeg';
import { SegmentClass } from '@fmgc/flightplanning/new/segments/SegmentClass';
import { FlightArea } from '@fmgc/navigation/FlightArea';
import { CopyOptions } from '@fmgc/flightplanning/new/plans/CloningOptions';
import { ImportedPerformanceData } from '@fmgc/flightplanning/new/uplink/SimBriefUplinkAdapter';
import {
    FlightPlanPerformanceData,
    FlightPlanPerformanceDataProperties,
} from '@fmgc/flightplanning/new/plans/performance/FlightPlanPerformanceData';
import { BaseFlightPlan, FlightPlanQueuedOperation, SerializedFlightPlan } from './BaseFlightPlan';

export class FlightPlan<P extends FlightPlanPerformanceData = FlightPlanPerformanceData> extends BaseFlightPlan<P> {
    static empty<P extends FlightPlanPerformanceData>(index: number, bus: EventBus, performanceDataInit: P): FlightPlan<P> {
        return new FlightPlan(index, bus, performanceDataInit);
    }

    /**
     * Alternate flight plan associated with this flight plan
     */
    alternateFlightPlan = new AlternateFlightPlan<P>(this.index, this);

    /**
     * Performance data for this flight plan
     */
    performanceData: P;

    /**
     * FIX INFO entries
     */
    fixInfos: readonly FixInfoEntry[] = [];

    /**
     * Shown as the "flight number" in the MCDU, but it's really the callsign
     */
    flightNumber: string | undefined = undefined;

    constructor(index: number, bus: EventBus, performanceDataInit: P) {
        super(index, bus);
        this.performanceData = performanceDataInit;
    }

    destroy() {
        super.destroy();

        this.alternateFlightPlan.destroy();
    }

    clone(newIndex: number, options: number = CopyOptions.Default): FlightPlan<P> {
        const newPlan = FlightPlan.empty(newIndex, this.bus, this.performanceData.clone());

        newPlan.version = this.version;
        newPlan.originSegment = this.originSegment.clone(newPlan);
        newPlan.departureRunwayTransitionSegment = this.departureRunwayTransitionSegment.clone(newPlan);
        newPlan.departureSegment = this.departureSegment.clone(newPlan);
        newPlan.departureEnrouteTransitionSegment = this.departureEnrouteTransitionSegment.clone(newPlan);
        newPlan.enrouteSegment = this.enrouteSegment.clone(newPlan);
        newPlan.arrivalEnrouteTransitionSegment = this.arrivalEnrouteTransitionSegment.clone(newPlan);
        newPlan.arrivalSegment = this.arrivalSegment.clone(newPlan);
        newPlan.arrivalRunwayTransitionSegment = this.arrivalRunwayTransitionSegment.clone(newPlan);
        newPlan.approachViaSegment = this.approachViaSegment.clone(newPlan);
        newPlan.approachSegment = this.approachSegment.clone(newPlan);
        newPlan.destinationSegment = this.destinationSegment.clone(newPlan);
        newPlan.missedApproachSegment = this.missedApproachSegment.clone(newPlan);

        newPlan.alternateFlightPlan = this.alternateFlightPlan.clone(newPlan);

        newPlan.availableOriginRunways = [...this.availableOriginRunways];
        newPlan.availableDepartures = [...this.availableDepartures];
        newPlan.availableDestinationRunways = [...this.availableDestinationRunways];
        newPlan.availableArrivals = [...this.availableArrivals];
        newPlan.availableApproaches = [...this.availableApproaches];
        newPlan.availableApproachVias = [...this.availableApproachVias];

        newPlan.activeLegIndex = this.activeLegIndex;

        newPlan.flightNumber = this.flightNumber;

        if (options & CopyOptions.IncludeFixInfos) {
            newPlan.fixInfos = this.fixInfos.map((it) => it?.clone());
        }

        return newPlan;
    }

    get alternateDestinationAirport(): Airport {
        return this.alternateFlightPlan.destinationAirport;
    }

    async setAlternateDestinationAirport(icao: string | undefined) {
        // TODO setting both airport and runway here means we fetch the airport's approaches twice from the DB
        // TODO optimize
        await this.alternateFlightPlan.setDestinationAirport(icao);
        // Reset procedures because they don't make sense anymore for the new alternate
        await this.alternateFlightPlan.setDestinationRunway(undefined);
        await this.alternateFlightPlan.setArrivalEnrouteTransition(undefined);
        await this.alternateFlightPlan.setArrival(undefined);
        await this.alternateFlightPlan.setApproach(undefined);
        await this.alternateFlightPlan.setApproachVia(undefined);

        if (this.alternateFlightPlan.originAirport) {
            this.alternateFlightPlan.availableOriginRunways = await loadAllRunways(this.alternateFlightPlan.originAirport);
            this.alternateFlightPlan.availableDepartures = await loadAllDepartures(this.alternateFlightPlan.originAirport);
        }

        await this.alternateFlightPlan.originSegment.refreshOriginLegs();

        await this.alternateFlightPlan.flushOperationQueue();
    }

    deleteAlternateFlightPlan() {
        this.setAlternateDestinationAirport(undefined);

        this.alternateFlightPlan.setOriginRunway(undefined);
        this.alternateFlightPlan.setDeparture(undefined);
        this.alternateFlightPlan.setDepartureEnrouteTransition(undefined);

        this.alternateFlightPlan.allLegs.length = 0;

        this.alternateFlightPlan.incrementVersion();
    }

    directToLeg(ppos: Coordinates, trueTrack: Degrees, targetLegIndex: number, withAbeam = false) {
        if (targetLegIndex >= this.firstMissedApproachLegIndex) {
            throw new Error('[FPM] Cannot direct to a leg in the missed approach segment');
        }

        const targetLeg = this.legElementAt(targetLegIndex);
        if (!targetLeg.isXF()) {
            throw new Error('[FPM] Cannot direct to a non-XF leg');
        }

        const magVar = MagVar.get(ppos.lat, ppos.long);
        const magneticCourse = A32NX_Util.trueToMagnetic(trueTrack, magVar);

        const turningPoint = FlightPlanLeg.turningPoint(this.enrouteSegment, ppos, magneticCourse);
        const turnEnd = FlightPlanLeg.directToTurnEnd(this.enrouteSegment, targetLeg.terminationWaypoint());

        turningPoint.flags |= FlightPlanLegFlags.DirectToTurningPoint;
        turnEnd.withDefinitionFrom(targetLeg).withPilotEnteredDataFrom(targetLeg);

        this.redistributeLegsAt(0);
        this.redistributeLegsAt(targetLegIndex);

        const indexInEnrouteSegment = this.enrouteSegment.allLegs.findIndex((it) => it === targetLeg);
        if (indexInEnrouteSegment === -1) {
            throw new Error('[FPM] Target leg of a direct to not found in enroute segment after leg redistribution!');
        }

        this.enrouteSegment.allLegs.splice(0, indexInEnrouteSegment + 1, turningPoint, turnEnd);
        this.incrementVersion();

        const turnEndLegIndexInPlan = this.allLegs.findIndex((it) => it === turnEnd);

        this.setActiveLegIndex(turnEndLegIndexInPlan);
    }

    directToWaypoint(ppos: Coordinates, trueTrack: Degrees, waypoint: Fix, withAbeam = false) {
        // TODO withAbeam
        // TODO handle direct-to into the alternate (make alternate active...?
        const existingLegIndex = this.allLegs.findIndex((it) => it.isDiscontinuity === false && it.terminatesWithWaypoint(waypoint));
        if (existingLegIndex !== -1 && existingLegIndex < this.firstMissedApproachLegIndex) {
            this.directToLeg(ppos, trueTrack, existingLegIndex, withAbeam);
            return;
        }

        const magVar = MagVar.get(ppos.lat, ppos.long);
        const magneticCourse = A32NX_Util.trueToMagnetic(trueTrack, magVar);

        const turningPoint = FlightPlanLeg.turningPoint(this.enrouteSegment, ppos, magneticCourse);
        const turnEnd = FlightPlanLeg.directToTurnEnd(this.enrouteSegment, waypoint);

        turningPoint.flags |= FlightPlanLegFlags.DirectToTurningPoint;

        // Move all legs before active one to the enroute segment
        let indexInEnrouteSegment = 0;
        this.redistributeLegsAt(0);
        if (this.activeLegIndex >= 1) {
            this.redistributeLegsAt(this.activeLegIndex);
            indexInEnrouteSegment = this.enrouteSegment.allLegs.findIndex((it) => it === this.activeLeg);
        }

        // Remove legs before active on from enroute
        this.enrouteSegment.allLegs.splice(0, indexInEnrouteSegment, turningPoint, turnEnd);
        this.incrementVersion();

        const turnEndLegIndexInPlan = this.allLegs.findIndex((it) => it === turnEnd);
        if (this.maybeElementAt(turnEndLegIndexInPlan + 1)?.isDiscontinuity === false) {
            this.enrouteSegment.allLegs.splice(2, 0, { isDiscontinuity: true });
            this.syncSegmentLegsChange(this.enrouteSegment);
            this.incrementVersion();

            // Since we added a discontinuity after the DIR TO leg, we want to make sure that the leg after it
            // is a leg that can be after a disco (not something like a CI) and convert it to IF
            this.cleanUpAfterDiscontinuity(turnEndLegIndexInPlan + 1);
        }

        this.setActiveLegIndex(turnEndLegIndexInPlan);
    }

    /**
     * Find next XF leg after a discontinuity and convert it to IF
     * Remove non-ground-referenced leg after the discontinuity before the XF leg
     * @param discontinuityIndex
     */
    private cleanUpAfterDiscontinuity(discontinuityIndex: number) {
        // Find next XF leg
        const xFLegIndexInPlan = this.allLegs.findIndex((it, index) => index > discontinuityIndex && it.isDiscontinuity === false && it.isXF());

        if (xFLegIndexInPlan !== -1) {
            // Remove elements to next XF leg
            this.removeRange(discontinuityIndex + 1, xFLegIndexInPlan);
            this.incrementVersion();

            // Replace next XF leg with IF leg if not already IF or CF
            const [segment, xfLegIndexInSegment] = this.segmentPositionForIndex(xFLegIndexInPlan);
            const xfLegAfterDiscontinuity = segment.allLegs[xfLegIndexInSegment] as FlightPlanLeg;

            if (xfLegAfterDiscontinuity.type !== LegType.IF && xfLegAfterDiscontinuity.type !== LegType.CF) {
                const iFLegAfterDiscontinuity = FlightPlanLeg.fromEnrouteFix(segment, xfLegAfterDiscontinuity.definition.waypoint, '', LegType.IF)
                    .withDefinitionFrom(xfLegAfterDiscontinuity)
                    .withPilotEnteredDataFrom(xfLegAfterDiscontinuity);

                segment.allLegs.splice(xfLegIndexInSegment, 1, iFLegAfterDiscontinuity);
                this.syncSegmentLegsChange(segment);
                this.incrementVersion();
            }
        }
    }

    // TODO this is wrong and we need to redo all this
    // we wanna end up with:
    // - revise point
    // - disco
    // - destination airport
    // - complete alternate routing
    async enableAltn(atIndex: number, cruiseLevel: number) {
        if (!this.alternateDestinationAirport) {
            throw new Error('[FMS/FPM] Cannot enable alternate with no alternate destination defined');
        }

        this.redistributeLegsAt(atIndex);

        if (this.legCount > atIndex + 1) {
            this.removeRange(atIndex + 1, this.legCount);
        }

        await this.setDestinationAirport(this.alternateDestinationAirport.ident);
        await this.setDestinationRunway(this.alternateFlightPlan.destinationRunway?.ident ?? undefined);
        // We call the segment methods because we only want to rebuild the arrival/approach when we've changed all the procedures
        await this.approachSegment.setProcedure(this.alternateFlightPlan.approach?.databaseId ?? undefined);
        await this.approachViaSegment.setProcedure(this.alternateFlightPlan.approachVia?.databaseId ?? undefined);
        await this.arrivalSegment.setProcedure(this.alternateFlightPlan.arrival?.databaseId ?? undefined);
        await this.arrivalEnrouteTransitionSegment.setProcedure(this.alternateFlightPlan.arrivalEnrouteTransition?.databaseId ?? undefined);

        const alternateLastEnrouteIndex = this.alternateFlightPlan.originSegment.legCount
            + this.alternateFlightPlan.departureRunwayTransitionSegment.legCount
            + this.alternateFlightPlan.departureSegment.legCount
            + this.alternateFlightPlan.departureEnrouteTransitionSegment.legCount
            + this.alternateFlightPlan.enrouteSegment.legCount + 1;
        const alternateLegsToInsert = this.alternateFlightPlan.allLegs.slice(0, alternateLastEnrouteIndex).map((it) => (it.isDiscontinuity === false ? it.clone(this.enrouteSegment) : it));

        // TODO add the destination again - don't know if the origin leg of the altn is counted here

        if (this.enrouteSegment.allLegs[this.enrouteSegment.legCount - 1]?.isDiscontinuity === false && alternateLegsToInsert[0]?.isDiscontinuity === false) {
            this.enrouteSegment.allLegs.push({ isDiscontinuity: true });
        }

        this.enrouteSegment.allLegs.push(...alternateLegsToInsert);
        this.syncSegmentLegsChange(this.enrouteSegment);
        this.enrouteSegment.strung = false;

        this.setPerformanceData('cruiseFlightLevel', cruiseLevel);
        this.setPerformanceData('costIndex', 0);

        this.deleteAlternateFlightPlan();

        this.enqueueOperation(FlightPlanQueuedOperation.RebuildArrivalAndApproach);
        this.enqueueOperation(FlightPlanQueuedOperation.Restring);
        await this.flushOperationQueue();
    }

    override async newDest(index: number, airportIdent: string): Promise<void> {
        await super.newDest(index, airportIdent);

        this.deleteAlternateFlightPlan();
    }

    setFixInfoEntry(index: 1 | 2 | 3 | 4, fixInfo: FixInfoData | null, notify = true): void {
        const planFixInfo = this.fixInfos as FixInfoEntry[];

        planFixInfo[index] = fixInfo ? new FixInfoEntry(fixInfo.fix, fixInfo.radii, fixInfo.radials) : undefined;

        if (notify) {
            this.sendEvent('flightPlan.setFixInfoEntry', { planIndex: this.index, forAlternate: false, index, fixInfo });
        }

        this.incrementVersion();
    }

    editFixInfoEntry(index: 1 | 2 | 3 | 4, callback: (fixInfo: FixInfoEntry) => FixInfoEntry, notify = true): void {
        const planFixInfo = this.fixInfos as FixInfoEntry[];

        const res = callback(planFixInfo[index]);

        if (res) {
            planFixInfo[index] = res;
        }

        if (notify) {
            this.sendEvent('flightPlan.setFixInfoEntry', { planIndex: this.index, forAlternate: false, index, fixInfo: res });
        }

        this.incrementVersion();
    }

    /**
     * Returns the active flight area for this flight plan
     */
    calculateActiveArea(): FlightArea {
        const activeLegIndex = this.activeLegIndex;

        if (activeLegIndex >= this.legCount) {
            return FlightArea.Enroute;
        }

        const [activeSegment] = this.segmentPositionForIndex(activeLegIndex);

        if (activeSegment === this.missedApproachSegment
            || activeSegment === this.destinationSegment
            || activeSegment === this.approachSegment
            || activeSegment === this.approachViaSegment
        ) {
            const approachType = this.approach?.type ?? ApproachType.Unknown;

            switch (approachType) {
            case ApproachType.Ils:
                return FlightArea.PrecisionApproach;
            case ApproachType.Gps:
            case ApproachType.Rnav:
                return FlightArea.GpsApproach;
            case ApproachType.Vor:
            case ApproachType.VorDme:
                return FlightArea.VorApproach;
            default:
                return FlightArea.NonPrecisionApproach;
            }
        }

        if (activeSegment.class === SegmentClass.Arrival || activeSegment.class === SegmentClass.Departure) {
            return FlightArea.Terminal;
        }

        return FlightArea.Enroute;
    }

    async setOriginAirport(icao: string): Promise<void> {
        await super.setOriginAirport(icao);

        FlightPlan.setOriginDefaultPerformanceData(this, this.originAirport);
    }

    async setDestinationAirport(icao: string | undefined): Promise<void> {
        await super.setDestinationAirport(icao);

        FlightPlan.setDestinationDefaultPerformanceData(this, this.destinationAirport);
    }

    /**
     * Sets performance data imported from uplink
     * @param data performance data available in uplink
     */
    setImportedPerformanceData(data: ImportedPerformanceData) {
        this.setPerformanceData('databaseTransitionAltitude', data.departureTransitionAltitude);
        this.setPerformanceData('databaseTransitionLevel', data.destinationTransitionLevel);
        this.setPerformanceData('costIndex', data.costIndex);
        this.setPerformanceData('cruiseFlightLevel', data.cruiseFlightLevel);
    }

    setFlightNumber(flightNumber: string, notify = true) {
        this.flightNumber = flightNumber;

        if (notify) {
            this.sendEvent('flightPlan.setFlightNumber', { planIndex: this.index, forAlternate: false, flightNumber });
        }
    }

    /**
     * Sets defaults for performance data parameters related to an origin
     *
     * @param plan the flight plan
     * @param airport the origin airport
     */
    private static setOriginDefaultPerformanceData<P extends FlightPlanPerformanceData>(plan: FlightPlan<P>, airport: Airport | undefined): void {
        const referenceAltitude = airport?.location.alt;

        if (referenceAltitude !== undefined) {
            plan.setPerformanceData('defaultThrustReductionAltitude', referenceAltitude + parseInt(NXDataStore.get('CONFIG_THR_RED_ALT', '1500')));
            plan.setPerformanceData('defaultAccelerationAltitude', referenceAltitude + parseInt(NXDataStore.get('CONFIG_ACCEL_ALT', '1500')));
            plan.setPerformanceData('defaultEngineOutAccelerationAltitude', referenceAltitude + parseInt(NXDataStore.get('CONFIG_ENG_OUT_ACCEL_ALT', '1500')));
        } else {
            plan.setPerformanceData('defaultThrustReductionAltitude', undefined);
            plan.setPerformanceData('defaultAccelerationAltitude', undefined);
            plan.setPerformanceData('defaultEngineOutAccelerationAltitude', undefined);
        }

        plan.setPerformanceData('pilotThrustReductionAltitude', undefined);
        plan.setPerformanceData('pilotAccelerationAltitude', undefined);
        plan.setPerformanceData('pilotEngineOutAccelerationAltitude', undefined);
    }

    /**
     * Sets defaults for performance data parameters related to a destination
     *
     * @param plan the flight plan
     * @param airport the destination airport
     */
    private static setDestinationDefaultPerformanceData<P extends FlightPlanPerformanceData>(plan: FlightPlan<P>, airport: Airport): void {
        const referenceAltitude = airport?.location.alt;

        if (referenceAltitude !== undefined) {
            plan.setPerformanceData('defaultMissedThrustReductionAltitude', referenceAltitude + parseInt(NXDataStore.get('CONFIG_THR_RED_ALT', '1500')));
            plan.setPerformanceData('defaultMissedAccelerationAltitude', referenceAltitude + parseInt(NXDataStore.get('CONFIG_ACCEL_ALT', '1500')));
            plan.setPerformanceData('defaultMissedEngineOutAccelerationAltitude', referenceAltitude + parseInt(NXDataStore.get('CONFIG_ENG_OUT_ACCEL_ALT', '1500')));
        } else {
            plan.setPerformanceData('defaultMissedThrustReductionAltitude', undefined);
            plan.setPerformanceData('defaultMissedAccelerationAltitude', undefined);
            plan.setPerformanceData('defaultMissedEngineOutAccelerationAltitude', undefined);
        }

        plan.setPerformanceData('pilotMissedThrustReductionAltitude', undefined);
        plan.setPerformanceData('pilotMissedAccelerationAltitude', undefined);
        plan.setPerformanceData('pilotMissedEngineOutAccelerationAltitude', undefined);
    }

    static fromSerializedFlightPlan<P extends FlightPlanPerformanceData>(
        index: number,
        serialized: SerializedFlightPlan,
        bus: EventBus,
        performanceDataInit: P,
    ): FlightPlan<P> {
        const newPlan = FlightPlan.empty<P>(index, bus, performanceDataInit);

        newPlan.activeLegIndex = serialized.activeLegIndex;
        newPlan.fixInfos = serialized.fixInfo;

        newPlan.originSegment.setFromSerializedSegment(serialized.segments.originSegment);
        newPlan.departureSegment.setFromSerializedSegment(serialized.segments.departureSegment);
        newPlan.departureRunwayTransitionSegment.setFromSerializedSegment(serialized.segments.departureRunwayTransitionSegment);
        newPlan.departureEnrouteTransitionSegment.setFromSerializedSegment(serialized.segments.departureEnrouteTransitionSegment);
        newPlan.enrouteSegment.setFromSerializedSegment(serialized.segments.enrouteSegment);
        newPlan.arrivalSegment.setFromSerializedSegment(serialized.segments.arrivalSegment);
        newPlan.arrivalRunwayTransitionSegment.setFromSerializedSegment(serialized.segments.arrivalRunwayTransitionSegment);
        newPlan.arrivalEnrouteTransitionSegment.setFromSerializedSegment(serialized.segments.arrivalEnrouteTransitionSegment);
        newPlan.approachSegment.setFromSerializedSegment(serialized.segments.approachSegment);
        newPlan.approachViaSegment.setFromSerializedSegment(serialized.segments.approachViaSegment);
        newPlan.destinationSegment.setFromSerializedSegment(serialized.segments.destinationSegment);

        return newPlan;
    }

    /**
     * Sets a performance data parameter
     *
     * The union type in the signature is to work around https://github.com/microsoft/TypeScript/issues/28662.
     */
    setPerformanceData<k extends(keyof (P & FlightPlanPerformanceDataProperties)) & string>(key: k, value: P[k] | null, notify = true) {
        this.performanceData[key] = value;

        if (notify) {
            this.sendPerfEvent(
                `flightPlan.setPerformanceData.${key}` as any,
                { planIndex: this.index, forAlternate: false, value } as any,
            );
        }

        this.incrementVersion();
    }

    /**
     * Check if the thrust reduction altitude is limited by a constraint and reduce it if so
     * @returns true if a reduction occured
     */
    reconcileThrustReductionWithConstraints(): boolean {
        const lowestClimbConstraint = MathUtils.round(this.lowestClimbConstraint(), 10);
        if (Number.isFinite(lowestClimbConstraint) && this.performanceData.thrustReductionAltitude > lowestClimbConstraint) {
            this.setPerformanceData('defaultThrustReductionAltitude',
                this.performanceData.defaultThrustReductionAltitude !== undefined ? Math.min(this.performanceData.defaultThrustReductionAltitude, lowestClimbConstraint) : undefined);
            this.setPerformanceData('pilotThrustReductionAltitude',
                this.performanceData.pilotThrustReductionAltitude !== undefined ? Math.min(this.performanceData.pilotThrustReductionAltitude, lowestClimbConstraint) : undefined);

            return true;
        }

        return false;
    }

    /**
     * Check if the acceleration altitude is limited by a constraint and reduce it if so
     * @returns true if a reduction occured
     */
    reconcileAccelerationWithConstraints(): boolean {
        const lowestClimbConstraint = MathUtils.round(this.lowestClimbConstraint(), 10);
        if (Number.isFinite(lowestClimbConstraint) && this.performanceData.accelerationAltitude > lowestClimbConstraint) {
            this.setPerformanceData('defaultAccelerationAltitude',
                this.performanceData.defaultAccelerationAltitude !== undefined ? Math.min(this.performanceData.defaultAccelerationAltitude, lowestClimbConstraint) : undefined);
            this.setPerformanceData('pilotAccelerationAltitude',
                this.performanceData.pilotAccelerationAltitude !== undefined ? Math.min(this.performanceData.pilotAccelerationAltitude, lowestClimbConstraint) : undefined);

            return true;
        }

        return false;
    }
}
