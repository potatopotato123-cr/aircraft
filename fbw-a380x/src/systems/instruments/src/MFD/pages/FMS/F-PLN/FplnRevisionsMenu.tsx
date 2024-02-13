import { TurnDirection } from '@flybywiresim/fbw-sdk';
import { HoldType } from '@fmgc/flightplanning/data/flightplan';
import { SegmentClass } from '@fmgc/flightplanning/new/segments/SegmentClass';
import { FlightPlanIndex } from '@fmgc/index';
import { MfdFmsFpln } from 'instruments/src/MFD/pages/FMS/F-PLN/MfdFmsFpln';
import { ContextMenuElement } from 'instruments/src/MFD/pages/common/ContextMenu';

export enum FplnRevisionsMenuType {
    Waypoint,
    PseudoWaypoint,
    Discontinuity,
    Runway,
    Departure,
    Arrival,
    TooSteepPath
}

export function getRevisionsMenu(fpln: MfdFmsFpln, type: FplnRevisionsMenuType): ContextMenuElement[] {
    const legIndex = fpln.props.fmcService.master?.revisedWaypointIndex.get() ?? 0;
    const planIndex = fpln.props.fmcService.master?.revisedWaypointPlanIndex.get() ?? FlightPlanIndex.Active;
    const altnFlightPlan = fpln.props.fmcService.master?.revisedWaypointIsAltn.get() ?? false;

    return [
        {
            title: 'FROM P.POS DIR TO',
            disabled: altnFlightPlan
                || (legIndex >= (fpln.loadedFlightPlan?.firstMissedApproachLegIndex ?? 0))
                || planIndex === FlightPlanIndex.Temporary
                || [FplnRevisionsMenuType.Discontinuity
                || FplnRevisionsMenuType.TooSteepPath].includes(type)
                || !fpln.loadedFlightPlan?.legElementAt(legIndex).isXF(),
            onSelectCallback: () => {
                fpln.props.fmcService.master?.flightPlanService.directToLeg(
                    fpln.props.fmcService.master.navigation.getPpos() ?? { lat: 0, long: 0 },
                    SimVar.GetSimVarValue('GPS GROUND TRUE TRACK', 'degree'),
                    legIndex,
                    true,
                    planIndex,
                );
                fpln.props.mfd.uiService.navigateTo(`fms/${fpln.props.mfd.uiService.activeUri.get().category}/f-pln-direct-to`);
            },
        },
        {
            title: 'INSERT NEXT WPT',
            disabled: false, // always enabled?
            onSelectCallback: () => fpln.openInsertNextWptFromWindow(),
        },
        {
            title: 'DELETE *',
            disabled: [FplnRevisionsMenuType.Runway || FplnRevisionsMenuType.TooSteepPath].includes(type) || planIndex === FlightPlanIndex.Temporary,
            onSelectCallback: () => {
                fpln.props.fmcService.master?.flightPlanService.deleteElementAt(legIndex, false, planIndex, altnFlightPlan);
            },
        },
        {
            title: 'DEPARTURE',
            disabled: (type !== FplnRevisionsMenuType.Departure && type !== FplnRevisionsMenuType.Runway),
            onSelectCallback: () => fpln.props.mfd.uiService.navigateTo(`fms/${fpln.props.mfd.uiService.activeUri.get().category}/f-pln-departure`),
        },
        {
            title: 'ARRIVAL',
            disabled: (type !== FplnRevisionsMenuType.Arrival && type !== FplnRevisionsMenuType.Runway),
            onSelectCallback: () => fpln.props.mfd.uiService.navigateTo(`fms/${fpln.props.mfd.uiService.activeUri.get().category}/f-pln-arrival`),
        },
        {
            title: '(N/A) OFFSET',
            disabled: true,
            onSelectCallback: () => fpln.props.mfd.uiService.navigateTo(`fms/${fpln.props.mfd.uiService.activeUri.get().category}/f-pln-hold`),
        },
        {
            title: 'HOLD',
            disabled: [FplnRevisionsMenuType.Discontinuity || FplnRevisionsMenuType.TooSteepPath].includes(type),
            onSelectCallback: async () => {
                const waypoint = fpln.props.fmcService.master?.flightPlanService.active.legElementAt(legIndex);
                if (waypoint && !waypoint.isHX()) {
                    const alt = waypoint.definition.altitude1 ? waypoint.definition.altitude1 : SimVar.GetSimVarValue('INDICATED ALTITUDE', 'feet');

                    const previousLeg = fpln.props.fmcService.master?.flightPlanService.active.maybeElementAt(legIndex - 1);

                    let inboundMagneticCourse = 100;
                    const prevTerm = previousLeg?.isDiscontinuity === false && previousLeg?.terminationWaypoint();
                    const wptTerm = waypoint.terminationWaypoint();
                    if (previousLeg && previousLeg.isDiscontinuity === false && previousLeg.isXF() && prevTerm && wptTerm) {
                        inboundMagneticCourse = Avionics.Utils.computeGreatCircleHeading(
                            prevTerm.location,
                            wptTerm.location,
                        );
                    }

                    const defaultHold = {
                        inboundMagneticCourse,
                        turnDirection: TurnDirection.Right,
                        time: alt <= 14000 ? 1 : 1.5,
                        type: HoldType.Computed,
                    };
                    await fpln.props.fmcService.master?.flightPlanService.addOrEditManualHold(
                        legIndex,
                        { ...defaultHold },
                        undefined,
                        defaultHold,
                        planIndex,
                        altnFlightPlan,
                    );

                    fpln.props.fmcService.master?.revisedWaypointIndex.set(legIndex + 1); // We just inserted a new HOLD leg
                }
                fpln.props.mfd.uiService.navigateTo(`fms/${fpln.props.mfd.uiService.activeUri.get().category}/f-pln-hold`);
            },
        },
        {
            title: 'AIRWAYS',
            disabled: [FplnRevisionsMenuType.Discontinuity || FplnRevisionsMenuType.TooSteepPath].includes(type),
            onSelectCallback: () => {
                fpln.props.fmcService.master?.flightPlanService.startAirwayEntry(legIndex);
                fpln.props.mfd.uiService.navigateTo(`fms/${fpln.props.mfd.uiService.activeUri.get().category}/f-pln-airways`);
            },
        },
        {
            title: (!altnFlightPlan
                && ![FplnRevisionsMenuType.Discontinuity || FplnRevisionsMenuType.TooSteepPath].includes(type)
                && fpln.loadedFlightPlan?.legElementAt(legIndex).definition.overfly === true) ? 'DELETE OVERFLY *' : 'OVERFLY *',
            disabled: altnFlightPlan || [FplnRevisionsMenuType.Discontinuity || FplnRevisionsMenuType.TooSteepPath].includes(type),
            onSelectCallback: () => fpln.props.fmcService.master?.flightPlanService.toggleOverfly(legIndex, planIndex, altnFlightPlan),
        },
        {
            title: 'ENABLE ALTN *',
            disabled: false,
            onSelectCallback: () => fpln.props.fmcService.master?.flightPlanService.enableAltn(legIndex, planIndex),
        },
        {
            title: 'NEW DEST',
            disabled: false,
            onSelectCallback: () => fpln.openNewDestWindow(),
        },
        {
            title: 'CONSTRAINTS',
            disabled: altnFlightPlan || [FplnRevisionsMenuType.Discontinuity || FplnRevisionsMenuType.TooSteepPath].includes(type),
            onSelectCallback: () => fpln.props.mfd.uiService.navigateTo(`fms/${fpln.props.mfd.uiService.activeUri.get().category}/f-pln-vert-rev/alt`),
        },
        {
            title: 'CMS',
            disabled: altnFlightPlan || [FplnRevisionsMenuType.Discontinuity || FplnRevisionsMenuType.TooSteepPath].includes(type),
            onSelectCallback: () => fpln.props.mfd.uiService.navigateTo(`fms/${fpln.props.mfd.uiService.activeUri.get().category}/f-pln-vert-rev/cms`),
        },
        {
            title: 'STEP ALTs',
            disabled: altnFlightPlan || [FplnRevisionsMenuType.Discontinuity || FplnRevisionsMenuType.TooSteepPath].includes(type),
            onSelectCallback: () => fpln.props.mfd.uiService.navigateTo(`fms/${fpln.props.mfd.uiService.activeUri.get().category}/f-pln-vert-rev/step-alts`),
        },
        {
            title: '(N/A) WIND',
            disabled: true,
            onSelectCallback: () => {
                // Find out whether waypoint is CLB, CRZ or DES waypoint and direct to appropriate WIND sub-page
                if (fpln.loadedFlightPlan?.legElementAt(legIndex)?.segment?.class === SegmentClass.Arrival) {
                    fpln.props.mfd.uiService.navigateTo(`fms/${fpln.props.mfd.uiService.activeUri.get().category}/wind/des`);
                } else if (fpln.loadedFlightPlan?.legElementAt(legIndex)?.segment?.class === SegmentClass.Enroute) {
                    fpln.props.mfd.uiService.navigateTo(`fms/${fpln.props.mfd.uiService.activeUri.get().category}/wind/crz`);
                } else {
                    fpln.props.mfd.uiService.navigateTo(`fms/${fpln.props.mfd.uiService.activeUri.get().category}/wind/clb`);
                }
            },
        },
    ];
}
