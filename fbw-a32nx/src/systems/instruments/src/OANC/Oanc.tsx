// Copyright (c) 2021-2023 FlyByWire Simulations
//
// SPDX-License-Identifier: GPL-3.0

import {
    ComponentProps,
    ConsumerSubject,
    DebounceTimer,
    DisplayComponent,
    EventBus,
    FSComponent,
    MappedSubject,
    Subject,
    SubscribableArrayEventType, UnitType,
    VNode,
} from '@microsoft/msfs-sdk';
import {
    AmdbFeatureCollection,
    AmdbFeatureTypeStrings,
    AmdbProjection,
    AmdbProperties,
    FeatureType,
    FeatureTypeString,
    MathUtils,
    PolygonStructureType,
} from '@flybywiresim/fbw-sdk';
import {
    BBox,
    bbox,
    centroid,
    Feature,
    featureCollection,
    FeatureCollection,
    Geometry,
    LineString, point,
    Point,
    Polygon,
    Position,
} from '@turf/turf';
import { bearingTo, clampAngle, Coordinates, distanceTo, placeBearingDistance } from 'msfs-geo';
import { reciprocal } from '@fmgc/guidance/lnav/CommonGeometry';
import { EfisNdMode } from '@shared/NavigationDisplay';
import { MapParameters } from '../ND/utils/MapParameters';
import { STYLE_DATA } from './style-data';
import { OancMovingModeOverlay, OancStaticModeOverlay } from './OancMovingModeOverlay';
import { OancAircraftIcon } from './OancAircraftIcon';
import { OancLabelManager } from './OancLabelManager';
import { OancPositionComputer } from './OancPositionComputer';
import { NavigraphAmdbClient } from './api/NavigraphAmdbClient';
import { FcuSimVars } from '../MsfsAvionicsCommon/providers/FcuBusPublisher';
import { pointAngle, pointDistance } from './OancMapUtils';

export const OANC_RENDER_WIDTH = 768;
export const OANC_RENDER_HEIGHT = 768;

const FEATURE_DRAW_PER_FRAME = 50;

const LABEL_MAX_DRAW_COUNT = 80;

const ZOOM_TRANSITION_TIME_MS = 300;

const LABEL_FEATURE_TYPES = [
    FeatureType.Taxiway,
    FeatureType.VerticalPolygonObject,
    FeatureType.Centerline,
    FeatureType.ParkingStandLocation,
];

const LABEL_POLYGON_STRUCTURE_TYPES = [
    PolygonStructureType.TerminalBuilding,
];

export const ZOOM_LEVELS = [0.2, 0.5, 1, 2.5];

const DEFAULT_SCALE_NM = 0.539957;

const ZOOM_LEVEL_SCALES = ZOOM_LEVELS.map((it) => (1 / (it * 2 / DEFAULT_SCALE_NM)));

const LAYER_VISIBILITY_RULES = [
    [true, true, true, true, false, false, true],
    [true, true, true, true, false, false, false],
    [false, true, false, false, true, true, false],
    [false, true, false, false, true, true, false],
];

export const LABEL_VISIBILITY_RULES = [
    true,
    true,
    true,
    false,
];

export enum LabelStyle {
    Taxiway= 'taxiway',
    TerminalBuilding = 'terminal-building',
    RunwayAxis = 'runway-axis',
    RunwayEnd = 'runway-end',
}

export interface Label {
    text: string,
    style: LabelStyle
    position: Position,
    rotation: number | undefined,
    associatedFeature: Feature<Geometry, AmdbProperties>,
}

export interface OancProps extends ComponentProps {
    bus: EventBus,
}

export class Oanc extends DisplayComponent<OancProps> {
    private readonly waitScreenRef = FSComponent.createRef<HTMLDivElement>();

    private readonly animationContainerRef = [
        FSComponent.createRef<HTMLDivElement>(),
        FSComponent.createRef<HTMLDivElement>(),
    ];

    private readonly panContainerRef = [
        FSComponent.createRef<HTMLDivElement>(),
        FSComponent.createRef<HTMLDivElement>(),
    ];

    private readonly layerCanvasRefs = [
        FSComponent.createRef<HTMLCanvasElement>(),
        FSComponent.createRef<HTMLCanvasElement>(),
        FSComponent.createRef<HTMLCanvasElement>(),
        FSComponent.createRef<HTMLCanvasElement>(),
        FSComponent.createRef<HTMLCanvasElement>(),
        FSComponent.createRef<HTMLCanvasElement>(),
        FSComponent.createRef<HTMLCanvasElement>(),
    ];

    private readonly layerCanvasScaleContainerRefs = [
        FSComponent.createRef<HTMLCanvasElement>(),
        FSComponent.createRef<HTMLCanvasElement>(),
        FSComponent.createRef<HTMLCanvasElement>(),
        FSComponent.createRef<HTMLCanvasElement>(),
        FSComponent.createRef<HTMLCanvasElement>(),
        FSComponent.createRef<HTMLCanvasElement>(),
        FSComponent.createRef<HTMLCanvasElement>(),
    ];

    public labelContainerRef = FSComponent.createRef<HTMLDivElement>();

    private cursorSurfaceRef = FSComponent.createRef<HTMLDivElement>();

    private readonly zoomInButtonRef = FSComponent.createRef<HTMLButtonElement>();

    private readonly zoomOutButtonRef = FSComponent.createRef<HTMLButtonElement>();

    private readonly positionTextRef = FSComponent.createRef<HTMLSpanElement>();

    public data: AmdbFeatureCollection | undefined;

    private dataBbox: BBox | undefined;

    private arpCoordinates: Coordinates | undefined;

    private canvasCenterCoordinates: Coordinates | undefined;

    private readonly dataAirportName = Subject.create('');

    private readonly dataAirportIcao = Subject.create('');

    private readonly dataAirportIata = Subject.create('');

    private readonly positionString = Subject.create('');

    private readonly positionVisible = Subject.create(false);

    private readonly airportInfoLine1 = this.dataAirportName.map((it) => it.toUpperCase());

    private readonly airportInfoLine2 = MappedSubject.create(([icao, iata]) => `${icao}  ${iata}`, this.dataAirportIcao, this.dataAirportIata);

    private layerFeatures: FeatureCollection<Geometry, AmdbProperties>[] = [
        featureCollection([]), // Layer 0: TAXIWAY BG + TAXIWAY SHOULDER
        featureCollection([]), // Layer 1: APRON + STAND BG + BUILDINGS (terminal only)
        featureCollection([]), // Layer 2: RUNWAY (with markings)
        featureCollection([]), // Layer 3: RUNWAY (without markings)
        featureCollection([]), // Layer 4: TAXIWAY GUIDANCE LINES (scaled width), HOLD SHORT LINES
        featureCollection([]), // Layer 5: TAXIWAY GUIDANCE LINES (unscaled width)
        featureCollection([]), // Layer 6: STAND GUIDANCE LINES (scaled width)
    ];

    private labelManager = new OancLabelManager(this);

    private positionComputer = new OancPositionComputer(this);

    public doneDrawing = false;

    private isPanning = false;

    private lastPanX = 0;

    private lastPanY = 0;

    public panOffsetX = Subject.create(0);

    public panOffsetY = Subject.create(0);

    private readonly isMapPanned = MappedSubject.create(([panX, panY]) => panX !== 0 || panY !== 0, this.panOffsetX, this.panOffsetY);

    public modeAnimationOffsetX = Subject.create(0);

    public modeAnimationOffsetY = Subject.create(0);

    private modeAnimationMapNorthUp = Subject.create(false);

    private readonly aircraftX = Subject.create(0);

    private readonly aircraftY = Subject.create(0);

    private readonly aircraftRotation = Subject.create(0);

    private canvasWidth = Subject.create(0);

    private canvasHeight = Subject.create(0);

    private canvasCentreX = Subject.create(0);

    private canvasCentreY = Subject.create(0);

    public readonly ppos: Coordinates = { lat: 0, long: 0 };

    public readonly projectedPpos: Position = [0, 0];

    private readonly planeTrueHeading = Subject.create(0);

    private readonly mapHeading = Subject.create(0);

    public readonly interpolatedMapHeading = Subject.create(0);

    public readonly zoomLevelIndex = Subject.create(0);

    public readonly canvasCentreReferencedMapParams = new MapParameters();

    public readonly arpReferencedMapParams = new MapParameters();

    private readonly efisNDModeSub = ConsumerSubject.create<EfisNdMode>(null, EfisNdMode.PLAN);

    private readonly overlayNDModeSub = Subject.create(EfisNdMode.PLAN);

    private readonly ndMOdeSwitchDelayDebouncer = new DebounceTimer();

    public getZoomLevelInverseScale() {
        const multiplier = this.efisNDModeSub.get() === EfisNdMode.ROSE_NAV ? 0.5 : 1;

        return ZOOM_LEVEL_SCALES[this.zoomLevelIndex.get()] * multiplier;
    }

    onAfterRender(node: VNode) {
        super.onAfterRender(node);

        this.cursorSurfaceRef.instance.addEventListener('mousedown', this.handleCursorPanStart.bind(this));
        this.cursorSurfaceRef.instance.addEventListener('mousemove', this.handleCursorPanMove.bind(this));
        this.cursorSurfaceRef.instance.addEventListener('mouseup', this.handleCursorPanStop.bind(this));

        // this.zoomOutButtonRef.instance.addEventListener('click', this.handleZoomOut.bind(this));
        // this.zoomInButtonRef.instance.addEventListener('click', this.handleZoomIn.bind(this));

        const subs = this.props.bus.getSubscriber<FcuSimVars>();

        this.efisNDModeSub.setConsumer(subs.on('ndMode'));

        this.efisNDModeSub.sub((mode) => this.handleNDModeChange(mode), true);

        this.loadAirportMap('LFPG');

        this.labelManager.visibleLabels.sub((index, type, item) => {
            switch (type) {
            case SubscribableArrayEventType.Added: {
                if (Array.isArray(item)) {
                    for (const label of item as Label[]) {
                        const element = this.createLabelElement(label);

                        this.labelContainerRef.instance.appendChild(element);
                        this.labelManager.visibleLabelElements.set(label, element);
                    }
                } else {
                    const element = this.createLabelElement(item as Label);

                    this.labelContainerRef.instance.appendChild(element);
                    this.labelManager.visibleLabelElements.set(item as Label, element);
                }
                break;
            }
            default: break;
            }
        });

        this.zoomLevelIndex.sub(() => {
            this.labelManager.showLabels = false;

            this.handleLayerVisibilities();

            setTimeout(() => this.labelManager.showLabels = true, ZOOM_TRANSITION_TIME_MS + 200);
        }, true);

        MappedSubject.create(this.panOffsetX, this.panOffsetY).sub(([x, y]) => {
            this.panContainerRef[0].instance.style.transform = `translate(${x}px, ${y}px)`;
            this.panContainerRef[1].instance.style.transform = `translate(${x}px, ${y}px)`;

            this.labelManager.reflowLabels();
        });

        MappedSubject.create(([x, y]) => {
            this.animationContainerRef[0].instance.style.transform = `translate(${x}px, ${y}px)`;
            this.animationContainerRef[1].instance.style.transform = `translate(${x}px, ${y}px)`;
        }, this.modeAnimationOffsetX, this.modeAnimationOffsetY);

        this.positionVisible.sub((visible) => this.positionTextRef.instance.style.visibility = visible ? 'inherit' : 'hidden');
    }

    private async loadAirportMap(icao: string) {
        const includeFeatureTypes: FeatureType[] = Object.values(STYLE_DATA).reduce((acc, it) => [...acc, ...it.reduce((acc, it) => [...acc, ...it.forFeatureTypes], [])], []);
        const includeLayers = includeFeatureTypes.map((it) => AmdbFeatureTypeStrings[it]);

        // Additional stuff we need that isn't handled by the canvas renderer
        includeLayers.push(FeatureTypeString.AerodromeReferencePoint);
        includeLayers.push(FeatureTypeString.ParkingStandLocation);

        const client = new NavigraphAmdbClient();

        const data = await client.getAirportData(icao, includeLayers, undefined);
        const wgs84ArpDat = await client.getAirportData(icao, [FeatureTypeString.AerodromeReferencePoint], undefined, AmdbProjection.Epsg4326);

        const features = Object.values(data).reduce((acc, it) => [...acc, ...it.features], [] as Feature<Geometry, AmdbProperties>[]);
        const airportMap: AmdbFeatureCollection = featureCollection(features);

        const wsg84ReferencePoint = wgs84ArpDat.aerodromereferencepoint.features[0];

        if (!wsg84ReferencePoint) {
            console.error('[OANC](loadAirportMap) Invalid airport data - aerodrome reference point not found');
            return;
        }

        const refPointLat = (wsg84ReferencePoint.geometry as Point).coordinates[1];
        const refPointLong = (wsg84ReferencePoint.geometry as Point).coordinates[0];
        const projectionScale = 1000;

        if (!refPointLat || !refPointLong || !projectionScale) {
            console.error('[OANC](loadAirportMap) Invalid airport data - aerodrome reference point does not contain lat/long/scale custom properties');
            return;
        }

        this.data = airportMap;

        this.dataAirportName.set(wsg84ReferencePoint.properties.name);
        this.dataAirportIcao.set(icao);
        this.dataAirportIata.set(wsg84ReferencePoint.properties.iata);

        // Figure out the boundaries of the map data

        const dataBbox = bbox(airportMap);

        const width = (dataBbox[2] - dataBbox[0]) * 1;
        const height = (dataBbox[3] - dataBbox[1]) * 1;

        this.canvasWidth.set(width);
        this.canvasHeight.set(height);
        this.canvasCentreX.set(Math.abs(dataBbox[0]));
        this.canvasCentreY.set(Math.abs(dataBbox[3]));

        this.arpCoordinates = { lat: refPointLat, long: refPointLong };
        this.canvasCenterCoordinates = this.calculateCanvasCenterCoordinates();

        this.sortDataIntoLayers(this.data);
        this.generateAllLabels(this.data);
    }

    private calculateCanvasCenterCoordinates() {
        const pxDistanceToCanvasCentre = pointDistance(
            (this.canvasWidth.get() / 2),
            (this.canvasHeight.get() / 2),
            this.canvasCentreX.get(),
            this.canvasCentreY.get(),
        );
        const nmDistanceToCanvasCentre = UnitType.NMILE.convertFrom((pxDistanceToCanvasCentre / 1_000), UnitType.KILOMETER);
        const angleToCanvasCentre = clampAngle(pointAngle(
            (this.canvasWidth.get() / 2),
            (this.canvasHeight.get() / 2),
            this.canvasCentreX.get(),
            this.canvasCentreY.get(),
        ) + 90);

        return placeBearingDistance(
            this.arpCoordinates,
            reciprocal(angleToCanvasCentre),
            nmDistanceToCanvasCentre,
        );
    }

    private createLabelElement(label: Label): HTMLSpanElement {
        const element = document.createElement('div');

        element.classList.add('oanc-label');
        element.classList.add(`oanc-label-style-${label.style}`);
        element.textContent = label.text;

        return element;
    }

    private sortDataIntoLayers(data: FeatureCollection<Geometry, AmdbProperties>) {
        for (let i = 0; i < this.layerFeatures.length; i++) {
            const layer = this.layerFeatures[i];

            const layerFeatureTypes = STYLE_DATA[i].reduce((acc, rule) => [...acc, ...rule.forFeatureTypes], [] as FeatureType[]);
            const layerPolygonStructureTypes = STYLE_DATA[i].reduce((acc, rule) => [...acc, ...(rule.forPolygonStructureTypes ?? [])], [] as PolygonStructureType[]);
            const layerData = data.features.filter((it) => {
                if (it.properties.feattype === FeatureType.VerticalPolygonObject) {
                    return layerFeatureTypes.includes(FeatureType.VerticalPolygonObject) && layerPolygonStructureTypes.includes(it.properties.plysttyp);
                }
                return layerFeatureTypes.includes(it.properties.feattype);
            });

            layer.features.push(...layerData);
        }
    }

    private generateAllLabels(data: FeatureCollection<Geometry, AmdbProperties>) {
        for (const feature of data.features) {
            if (!LABEL_FEATURE_TYPES.includes(feature.properties.feattype)) {
                continue;
            }

            // Only include "Taxiway" features that have a valid "idlin" property
            if (feature.properties.feattype === FeatureType.Taxiway && !feature.properties.idlin) {
                continue;
            }

            // Only include "VerticalPolygonObject" features whose "plysttyp" property has what we want
            if (feature.properties.feattype === FeatureType.VerticalPolygonObject && !LABEL_POLYGON_STRUCTURE_TYPES.includes(feature.properties.plysttyp)) {
                continue;
            }

            let labelPosition: Position;
            switch (feature.geometry.type) {
            case 'Point': {
                const point = feature.geometry as Point;

                labelPosition = point.coordinates;
                break;
            }
            case 'Polygon': {
                const polygon = feature.geometry as Polygon;

                labelPosition = centroid(polygon).geometry.coordinates;
                break;
            }
            case 'LineString': {
                const lineString = feature.geometry as LineString;

                labelPosition = centroid(lineString).geometry.coordinates;
                break;
            }
            default: {
                console.error(`[OANC] Cannot determine label position for geometry of type '${feature.geometry.type}'`);
            }
            }

            if (feature.properties.feattype === FeatureType.Centerline) {
                const designators = [];
                if (feature.properties.idrwy) {
                    designators.push(...feature.properties.idrwy.split('.'));
                }

                if (designators.length === 0) {
                    console.error(`Runway feature (id=${feature.properties.id}) does not have a valid idrwy value`);
                    continue;
                }

                const runwayLine = feature.geometry as LineString;
                const runwayLineStart = runwayLine.coordinates[0];
                const runwayLineEnd = runwayLine.coordinates[runwayLine.coordinates.length - 1];
                const runwayLineBearing = clampAngle(-Math.atan2(runwayLineStart[0] - runwayLineEnd[0], runwayLineStart[1] - runwayLineEnd[1]) * MathUtils.RADIANS_TO_DEGREES + 90);

                const label1: Label = {
                    text: `${designators[1]}`,
                    style: LabelStyle.RunwayEnd,
                    position: runwayLineStart,
                    rotation: reciprocal(runwayLineBearing),
                    associatedFeature: feature,
                };

                const label2: Label = {
                    text: `${designators[0]}`,
                    style: LabelStyle.RunwayEnd,
                    position: runwayLineEnd,
                    rotation: runwayLineBearing,
                    associatedFeature: feature,
                };

                const label3: Label = {
                    text: `${designators[0]}-${designators[1]}`,
                    style: LabelStyle.RunwayAxis,
                    position: runwayLineEnd,
                    rotation: runwayLineBearing,
                    associatedFeature: feature,
                };

                this.labelManager.labels.push(label1, label2, label3);
                this.labelManager.visibleLabels.insert(label1);
                this.labelManager.visibleLabels.insert(label2);
                this.labelManager.visibleLabels.insert(label3);
            } else {
                const text = feature.properties.idlin ?? feature.properties.idstd ?? feature.properties.ident ?? undefined;

                if (feature.properties.feattype === FeatureType.ParkingStandLocation && text !== undefined && text.includes('_')) {
                    continue;
                }

                if (text !== undefined) {
                    let style: LabelStyle.TerminalBuilding | LabelStyle.Taxiway;
                    switch (feature.properties.feattype) {
                    case FeatureType.VerticalPolygonObject:
                        style = LabelStyle.TerminalBuilding;
                        break;
                    case FeatureType.ParkingStandLocation:
                        style = LabelStyle.TerminalBuilding;
                        break;
                    default:
                        style = LabelStyle.Taxiway;
                        break;
                    }

                    const existing = this.labelManager.labels.filter((it) => it.text === text);

                    const shortestDistance = existing.reduce((shortestDistance, label) => {
                        const distance = pointDistance(label.position[0], label.position[1], labelPosition[0], labelPosition[1]);

                        return distance > shortestDistance ? distance : shortestDistance;
                    }, Number.MAX_SAFE_INTEGER);

                    if (
                        (feature.properties.feattype === FeatureType.ParkingStandLocation && existing.some((it) => feature.properties.termref === it.associatedFeature.properties.termref))
                        || shortestDistance < 50
                    ) {
                        continue;
                    }

                    const label = {
                        text: text.toUpperCase(),
                        style,
                        position: labelPosition,
                        rotation: undefined,
                        associatedFeature: feature,
                    };

                    this.labelManager.labels.push(label);
                    this.labelManager.visibleLabels.insert(label);
                }
            }
        }
    }

    private lastLayerDrawnIndex = 0;

    private lastFeatureDrawnIndex = 0;

    private lastTime = 0;

    private projectCoordinates(coordinates: Coordinates): [number, number] {
        const bearing = bearingTo(this.arpCoordinates, coordinates);
        const distance = distanceTo(this.arpCoordinates, coordinates);

        const xNm = distance * Math.cos(bearing * MathUtils.DEGREES_TO_RADIANS);
        const yNm = distance * Math.sin(bearing * MathUtils.DEGREES_TO_RADIANS);

        const nmToPx = 1_000 / 0.539957;

        return [yNm * nmToPx, xNm * nmToPx];
    }

    public Update() {
        const now = Date.now();
        const deltaTime = (now - this.lastTime) / 1_000;
        this.lastTime = now;

        this.ppos.lat = SimVar.GetSimVarValue('PLANE LATITUDE', 'Degrees');
        this.ppos.long = SimVar.GetSimVarValue('PLANE LONGITUDE', 'Degrees');
        this.planeTrueHeading.set(SimVar.GetSimVarValue('PLANE HEADING DEGREES TRUE', 'Degrees'));

        if (!this.data) {
            return;
        }

        const position = this.positionComputer.computePosition();

        if (position) {
            this.positionVisible.set(true);
            this.positionString.set(position);
        } else {
            this.positionVisible.set(false);
        }

        const mapTargetHeading = this.modeAnimationMapNorthUp.get() ? 0 : this.planeTrueHeading.get();
        this.mapHeading.set(mapTargetHeading);

        const interpolatedMapHeading = this.interpolatedMapHeading.get();

        if (Math.abs(mapTargetHeading - interpolatedMapHeading) > 0.1) {
            const rotateLeft = MathUtils.diffAngle(interpolatedMapHeading, mapTargetHeading) < 0;

            if (rotateLeft) {
                this.interpolatedMapHeading.set(clampAngle(interpolatedMapHeading - (deltaTime * 90)));

                if (MathUtils.diffAngle(this.interpolatedMapHeading.get(), mapTargetHeading) > 0) {
                    this.interpolatedMapHeading.set(mapTargetHeading);
                }
            } else {
                this.interpolatedMapHeading.set(clampAngle(interpolatedMapHeading + (deltaTime * 90)));

                if (MathUtils.diffAngle(this.interpolatedMapHeading.get(), mapTargetHeading) < 0) {
                    this.interpolatedMapHeading.set(mapTargetHeading);
                }
            }
        }

        const mapCurrentHeading = this.interpolatedMapHeading.get();

        this.canvasCentreReferencedMapParams.compute(this.canvasCenterCoordinates, 0, 0.539957, 1_000, mapCurrentHeading);
        this.arpReferencedMapParams.compute(this.arpCoordinates, 0, 0.539957, 1_000, mapCurrentHeading);

        // eslint-disable-next-line prefer-const
        let [offsetX, offsetY] = this.canvasCentreReferencedMapParams.coordinatesToXYy(this.ppos);

        [this.projectedPpos[0], this.projectedPpos[1]] = this.projectCoordinates(this.ppos);

        // TODO figure out how to not need this
        offsetY *= -1;

        const rotate = -mapCurrentHeading;

        // Transform layers
        for (let i = 0; i < this.layerCanvasRefs.length; i++) {
            const canvas = this.layerCanvasRefs[i].instance;
            const canvasScaleContainer = this.layerCanvasScaleContainerRefs[i].instance;

            const scale = this.getZoomLevelInverseScale();

            const translateX = -(this.canvasWidth.get() / 2) + (OANC_RENDER_WIDTH / 2);
            const translateY = -(this.canvasHeight.get() / 2) + (OANC_RENDER_HEIGHT / 2);

            canvas.style.transform = `translate(${-offsetX}px, ${offsetY}px) rotate(${rotate}deg)`;

            canvasScaleContainer.style.left = `${translateX}px`;
            canvasScaleContainer.style.top = `${translateY}px`;
            canvasScaleContainer.style.transform = `scale(${scale})`;

            const context = canvas.getContext('2d');

            context.resetTransform();

            context.translate(this.canvasCentreX.get(), this.canvasCentreY.get());
        }

        // Transform airplane
        this.aircraftX.set(384);
        this.aircraftY.set(384);
        this.aircraftRotation.set(this.planeTrueHeading.get() - mapCurrentHeading);

        // Reflow labels if necessary
        if (this.lastLayerDrawnIndex > this.layerCanvasRefs.length - 1) {
            this.doneDrawing = true;

            this.waitScreenRef.instance.style.visibility = 'hidden';

            this.labelManager.reflowLabels();

            return;
        }

        const layerFeatures = this.layerFeatures[this.lastLayerDrawnIndex];
        const layerCanvas = this.layerCanvasRefs[this.lastLayerDrawnIndex].instance.getContext('2d');

        if (this.lastFeatureDrawnIndex < layerFeatures.features.length) {
            renderFeaturesToCanvas(this.lastLayerDrawnIndex, layerCanvas, layerFeatures, this.lastFeatureDrawnIndex, this.lastFeatureDrawnIndex + FEATURE_DRAW_PER_FRAME);

            this.lastFeatureDrawnIndex += FEATURE_DRAW_PER_FRAME;
        } else {
            this.lastLayerDrawnIndex++;
            this.lastFeatureDrawnIndex = 0;
        }
    }

    private handleNDModeChange(newMode: EfisNdMode) {
        switch (newMode) {
        case EfisNdMode.ROSE_NAV:
            this.modeAnimationOffsetX.set(0);
            this.modeAnimationOffsetY.set(0);
            break;
        case EfisNdMode.ARC:
            this.modeAnimationOffsetX.set(0);
            this.modeAnimationOffsetY.set(620 - OANC_RENDER_HEIGHT / 2);
            break;
        case EfisNdMode.PLAN:
            this.modeAnimationOffsetX.set(0);
            this.modeAnimationOffsetY.set(0);
            break;
        default:
            // noop
        }

        this.ndMOdeSwitchDelayDebouncer.schedule(() => {
            this.overlayNDModeSub.set(newMode);

            switch (newMode) {
            case EfisNdMode.ROSE_NAV:
                this.modeAnimationMapNorthUp.set(false);
                break;
            case EfisNdMode.ARC:
                this.modeAnimationMapNorthUp.set(false);
                break;
            case EfisNdMode.PLAN:
                this.modeAnimationMapNorthUp.set(true);
                break;
            default:
                // noop
            }
        }, ZOOM_TRANSITION_TIME_MS);
    }

    private handleLayerVisibilities() {
        const rule = LAYER_VISIBILITY_RULES[this.zoomLevelIndex.get()];

        for (let i = 0; i < this.layerCanvasScaleContainerRefs.length; i++) {
            const shouldBeVisible = rule[i];

            const layerContainer = this.layerCanvasScaleContainerRefs[i].instance;

            layerContainer.style.visibility = shouldBeVisible ? 'inherit' : 'hidden';
        }
    }

    private handleZoomIn(): void {
        if (this.zoomLevelIndex.get() !== 0) {
            this.zoomLevelIndex.set(this.zoomLevelIndex.get() - 1);
        }
    }

    private handleZoomOut(): void {
        if (this.zoomLevelIndex.get() !== ZOOM_LEVELS.length - 1) {
            this.zoomLevelIndex.set(this.zoomLevelIndex.get() + 1);
        }
    }

    private handleCursorPanStart(event: MouseEvent): void {
        this.isPanning = true;
    }

    private handleCursorPanMove(event: MouseEvent): void {
        if (this.isPanning) {
            this.panOffsetX.set(this.panOffsetX.get() + event.screenX - this.lastPanX);
            this.panOffsetY.set(this.panOffsetY.get() + event.screenY - this.lastPanY);
        }

        this.lastPanX = event.screenX;
        this.lastPanY = event.screenY;
    }

    private handleCursorPanStop(event: MouseEvent): void {
        this.isPanning = false;
    }

    render(): VNode | null {
        return (
            <div class="oanc-container" style={`width: ${OANC_RENDER_WIDTH}px; height: ${OANC_RENDER_HEIGHT}px; overflow: hidden`}>
                <div ref={this.waitScreenRef} class="oanc-waiting-screen">
                    PLEASE WAIT
                </div>

                <svg viewBox="0 0 768 768" style="position: absolute;">
                    <defs>
                        <clipPath id="rose-mode-map-clip">
                            <path d="M45,155 L282,155 a250,250 0 0 1 204,0 L723,155 L723,562 L648,562 L591,625 L591,768 L174,768 L174,683 L122,625 L45,625 L45,155" />
                        </clipPath>
                        <clipPath id="rose-mode-wx-terr-clip">
                            <path d="M45,155 L282,155 a250,250 0 0 1 204,0 L723,155 L723,384 L45,384 L45,155" />
                        </clipPath>
                        <clipPath id="rose-mode-tcas-clip">
                            <path d="M45,155 L282,155 a250,250 0 0 1 204,0 L723,155 L723,562 L648,562 L591,625 L591,768 L174,768 L174,683 L122,625 L45,625 L45,155" />
                        </clipPath>
                        <clipPath id="arc-mode-map-clip">
                            <path d="M0,312 a492,492 0 0 1 768,0 L768,562 L648,562 L591,625 L591,768 L174,768 L174,683 L122,625 L0,625 L0,312" />
                        </clipPath>
                        <clipPath id="arc-mode-wx-terr-clip">
                            <path d="M0,312 a492,492 0 0 1 768,0 L768,562 L648,562 L591,625 L0,625 L0,312" />
                        </clipPath>
                        <clipPath id="arc-mode-tcas-clip">
                            <path d="M0,312 a492,492 0 0 1 768,0 L768,562 L648,562 L591,625 L591,768 L174,768 L174,683 L122,625 L0,625 L0,312" />
                        </clipPath>
                        <clipPath id="arc-mode-overlay-clip-4">
                            <path d="m 6 0 h 756 v 768 h -756 z" />
                        </clipPath>
                        <clipPath id="arc-mode-overlay-clip-3">
                            <path d="m 0 564 l 384 145 l 384 -145 v -564 h -768 z" />
                        </clipPath>
                        <clipPath id="arc-mode-overlay-clip-2">
                            <path d="m 0 532 l 384 155 l 384 -146 v -512 h -768 z" />
                        </clipPath>
                        <clipPath id="arc-mode-overlay-clip-1">
                            <path d="m 0 519 l 384 145 l 384 -86 v -580 h -768 z" />
                        </clipPath>
                    </defs>
                </svg>

                <div ref={this.animationContainerRef[0]} style={`position: absolute; transition: transform ${ZOOM_TRANSITION_TIME_MS}ms linear;`}>
                    <div ref={this.panContainerRef[0]} style="position: absolute;">
                        <div ref={this.layerCanvasScaleContainerRefs[0]} style={`position: absolute; transition: transform ${ZOOM_TRANSITION_TIME_MS}ms linear;`}>
                            <canvas ref={this.layerCanvasRefs[0]} width={this.canvasWidth} height={this.canvasHeight} />
                        </div>
                        <div ref={this.layerCanvasScaleContainerRefs[1]} style={`position: absolute; transition: transform ${ZOOM_TRANSITION_TIME_MS}ms linear;`}>
                            <canvas ref={this.layerCanvasRefs[1]} width={this.canvasWidth} height={this.canvasHeight} />
                        </div>
                        <div ref={this.layerCanvasScaleContainerRefs[2]} style={`position: absolute; transition: transform ${ZOOM_TRANSITION_TIME_MS}ms linear;`}>
                            <canvas ref={this.layerCanvasRefs[2]} width={this.canvasWidth} height={this.canvasHeight} />
                        </div>
                        <div ref={this.layerCanvasScaleContainerRefs[3]} style={`position: absolute; transition: transform ${ZOOM_TRANSITION_TIME_MS}ms linear;`}>
                            <canvas ref={this.layerCanvasRefs[3]} width={this.canvasWidth} height={this.canvasHeight} />
                        </div>
                        <div ref={this.layerCanvasScaleContainerRefs[4]} style={`position: absolute; transition: transform ${ZOOM_TRANSITION_TIME_MS}ms linear;`}>
                            <canvas ref={this.layerCanvasRefs[4]} width={this.canvasWidth} height={this.canvasHeight} />
                        </div>
                        <div ref={this.layerCanvasScaleContainerRefs[5]} style={`position: absolute; transition: transform ${ZOOM_TRANSITION_TIME_MS}ms linear;`}>
                            <canvas ref={this.layerCanvasRefs[5]} width={this.canvasWidth} height={this.canvasHeight} />
                        </div>
                        <div ref={this.layerCanvasScaleContainerRefs[6]} style={`position: absolute; transition: transform ${ZOOM_TRANSITION_TIME_MS}ms linear;`}>
                            <canvas ref={this.layerCanvasRefs[6]} width={this.canvasWidth} height={this.canvasHeight} />
                        </div>

                        <OancAircraftIcon x={this.aircraftX} y={this.aircraftY} rotation={this.aircraftRotation} />
                    </div>
                </div>

                <div ref={this.labelContainerRef} style={`position: absolute; width: ${OANC_RENDER_WIDTH}px; height: ${OANC_RENDER_HEIGHT}px;`} />

                <div ref={this.animationContainerRef[1]} style={`position: absolute; transition: transform ${ZOOM_TRANSITION_TIME_MS}ms linear; pointer-events: none;`}>
                    <div ref={this.panContainerRef[1]} style="position: absolute;">
                        <OancMovingModeOverlay
                            bus={this.props.bus}
                            oansRange={this.zoomLevelIndex.map((it) => ZOOM_LEVELS[it])}
                            ndMode={this.overlayNDModeSub}
                            rotation={this.interpolatedMapHeading}
                            isMapPanned={this.isMapPanned}
                        />
                    </div>
                </div>

                <div ref={this.cursorSurfaceRef} style={`position: absolute; width: ${OANC_RENDER_WIDTH}px; height: ${OANC_RENDER_HEIGHT}px; pointer-events: auto;`} />

                <div
                    style={`position: absolute; width: ${OANC_RENDER_WIDTH}px; height: ${OANC_RENDER_HEIGHT}px; pointer-events: none`}
                >
                    <div class="oanc-top-mask" />
                    <div class="oanc-bottom-mask">
                        <span ref={this.positionTextRef} class="oanc-position">{this.positionString}</span>
                    </div>

                    {/* TODO this is rendered by ND */}
                    <span class="oanc-speed-info" id="oanc-speed-info-line1">
                        <span id="oanc-speed-info-1">GS</span>
                        <span id="oanc-speed-info-2">0</span>
                        <span id="oanc-speed-info-3">TAS</span>
                        <span id="oanc-speed-info-4">---</span>
                    </span>

                    {/* TODO this is rendered by ND */}
                    <span class="oanc-wind-info">
                        <span id="oanc-wind-info-1">---</span>
                        <span id="oanc-wind-info-2">/</span>
                        <span id="oanc-wind-info-3">---</span>
                    </span>

                    <span class="oanc-airport-info" id="oanc-airport-info-line1">{this.airportInfoLine1}</span>
                    <span class="oanc-airport-info" id="oanc-airport-info-line2">{this.airportInfoLine2}</span>

                    {/* <button ref={this.zoomInButtonRef} type="button" class="oanc-button">+</button> */}
                    {/* <button ref={this.zoomOutButtonRef} type="button" class="oanc-button">-</button> */}
                </div>

                <OancStaticModeOverlay
                    bus={this.props.bus}
                    oansRange={this.zoomLevelIndex.map((it) => ZOOM_LEVELS[it])}
                    ndMode={this.overlayNDModeSub}
                    rotation={this.interpolatedMapHeading}
                    isMapPanned={this.isMapPanned}
                />
            </div>
        );
    }
}

const pathCache = new Map< string, Path2D[]>();
const pathIdCache = new Map<Feature, string>();

function renderFeaturesToCanvas(layer: number, ctx: CanvasRenderingContext2D, data: FeatureCollection<Geometry, AmdbProperties>, startIndex: number, endIndex: number) {
    console.log(`rendering features: ${data.features.length}`);

    const styleRules = STYLE_DATA[layer];

    for (let i = startIndex; i < Math.min(endIndex, data.features.length); i++) {
        const feature = data.features[i];
        let doStroke = false;

        let doFill = false;

        const matchingRule = styleRules.find((it) => {
            if (feature.properties.feattype === FeatureType.VerticalPolygonObject) {
                return it.forFeatureTypes.includes(feature.properties.feattype)
                    && it.forPolygonStructureTypes.includes(feature.properties.plysttyp);
            }

            return it.forFeatureTypes.includes(feature.properties.feattype);
        });

        if (!matchingRule) {
            console.error(`No matching style rule for feature (feattype=${feature.properties.feattype}) in rules for layer #${layer}`);
            continue;
        }

        if (matchingRule.styles.doStroke !== undefined) {
            doStroke = matchingRule.styles.doStroke;
        }

        if (matchingRule.styles.doFill !== undefined) {
            doFill = matchingRule.styles.doFill;
        }

        if (matchingRule.styles.strokeStyle !== undefined) {
            ctx.strokeStyle = matchingRule.styles.strokeStyle;
        }

        if (matchingRule.styles.lineWidth !== undefined) {
            ctx.lineWidth = matchingRule.styles.lineWidth;
        }

        if (matchingRule.styles.fillStyle !== undefined) {
            ctx.fillStyle = matchingRule.styles.fillStyle;
        }

        let id = pathIdCache.get(feature);
        if (!id) {
            id = `${feature.properties.id}-${feature.properties.feattype}`;

            pathIdCache.set(feature, id);
        }

        const cachedPaths = pathCache.get(id);

        switch (feature.geometry.type) {
        case 'LineString': {
            const outline = feature.geometry as LineString;

            let path: Path2D;
            if (cachedPaths) {
                // eslint-disable-next-line prefer-destructuring
                path = cachedPaths[0];
            } else {
                path = new Path2D();

                path.moveTo(outline.coordinates[0][0], outline.coordinates[0][1] * -1);

                for (let i = 1; i < outline.coordinates.length; i++) {
                    const point = outline.coordinates[i];
                    path.lineTo(point[0], point[1] * -1);
                }

                pathCache.set(`${feature.properties.id}-${feature.properties.feattype}`, [path]);
            }

            if (doFill) {
                ctx.fill(path);
            }

            if (doStroke) {
                ctx.stroke(path);
            }

            break;
        }
        case 'Polygon': {
            const polygon = feature.geometry as Polygon;

            let paths: Path2D[] = [];
            if (cachedPaths) {
                paths = cachedPaths;
            } else {
                for (const outline of polygon.coordinates) {
                    const toCachePath = new Path2D();

                    toCachePath.moveTo(outline[0][0], outline[0][1] * -1);

                    for (let i = 1; i < outline.length; i++) {
                        const point = outline[i];
                        toCachePath.lineTo(point[0], point[1] * -1);
                    }

                    paths.push(toCachePath);
                }

                pathCache.set(`${feature.properties.id}-${feature.properties.feattype}`, paths);
            }

            for (const path of paths) {
                if (doStroke) {
                    ctx.stroke(path);
                }

                if (doFill) {
                    ctx.fill(path);
                }
            }
            break;
        }
        default: {
            console.log(`Could not draw geometry of type: ${feature.geometry.type}`);
            break;
        }
        }
    }
}
