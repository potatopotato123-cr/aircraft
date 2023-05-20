import { DisplayComponent, FSComponent, Subscribable, VNode } from '@microsoft/msfs-sdk';
import '../common/style.scss';
import { EntityTypes } from 'instruments/src/MFD/pages/OANS/OANS';

interface OANSRunwayInfoBoxProps {
    rwyOrStand: Subscribable<EntityTypes>;
    selectedEntity: Subscribable<string>;
    tora: Subscribable<number>;
    lda: Subscribable<number>;
    ldaIsReduced: Subscribable<boolean>;
    coordinate: Subscribable<string>;
}
export class OANSRunwayInfoBox extends DisplayComponent<OANSRunwayInfoBoxProps> {
    private rwyDivRef = FSComponent.createRef<HTMLDivElement>();

    private standDivRef = FSComponent.createRef<HTMLDivElement>();

    private setDivs(rwyOrStand) {
        if (rwyOrStand === EntityTypes.RWY) {
            this.rwyDivRef.instance.style.display = 'grid';
            this.standDivRef.instance.style.display = 'none';
        } else if (rwyOrStand === EntityTypes.STAND) {
            this.rwyDivRef.instance.style.display = 'none';
            this.standDivRef.instance.style.display = 'flex';
        } else {
            this.rwyDivRef.instance.style.display = 'none';
            this.standDivRef.instance.style.display = 'none';
        }
    }

    onAfterRender(node: VNode): void {
        super.onAfterRender(node);

        this.setDivs(this.props.rwyOrStand.get());

        this.props.rwyOrStand.sub((val) => {
            this.setDivs(val);
        });
    }

    render(): VNode {
        return (
            <>
                <div ref={this.rwyDivRef} class="OANSInfoBox" style="display: none; grid-template-columns: 2fr 1fr 1fr; width: 75%; margin: 10px; align-self: center;">
                    <div>
                        <span class="MFDLabel">RWY: </span>
                        <span class="MFDGreenValue smaller" style="text-align: left;">{this.props.selectedEntity}</span>
                    </div>
                    <span class="MFDLabel" style="text-align: right; margin-right: 15px;">TORA: </span>
                    <span class="MFDGreenValue smaller">
                        {`${this.props.tora.get().toString()} `}
                        <span style="color: rgb(33, 33, 255)">M</span>
                    </span>
                    <span class="MFDLabel" style="grid-column: span 2; text-align: right; margin-right: 15px;">{`${this.props.ldaIsReduced.get() ? 'REDUCED ' : ''}LDA: `}</span>
                    <span class="MFDGreenValue smaller" style={this.props.ldaIsReduced.get() ? 'color: cyan;' : ''}>
                        {`${this.props.lda.get().toString()} `}
                        <span style="color: rgb(33, 33, 255)">M</span>
                    </span>
                </div>
                <div ref={this.standDivRef} class="OANSInfoBox" style="display: none; flex-direction: column; width: 75%; margin: 10px; align-self: center; align-items: center;">
                    <span class="MFDLabel">
                        STAND:
                        <span style="color: #00ff00">{this.props.selectedEntity}</span>
                    </span>
                    <span class="MFDLabel" style="align-self: flex-end; color: #00ff00">{this.props.coordinate}</span>
                </div>
            </>
        );
    }
}
