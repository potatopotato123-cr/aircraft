import { ArraySubject, DisplayComponent, FSComponent, Subject, Subscribable, Subscription, VNode } from '@microsoft/msfs-sdk';
import { MfdComponentProps } from 'instruments/src/MFD/MFD';
import { DropdownMenu } from 'instruments/src/MFD/pages/common/DropdownMenu';
import { PageSelectorDropdownMenu } from 'instruments/src/MFD/pages/common/PageSelectorDropdownMenu';

interface MfdSurvHeaderProps extends MfdComponentProps {
    activeFmsSource: Subscribable<'FMS 1' | 'FMS 2' | 'FMS 1-C' | 'FMS 2-C'>;
    callsign: Subscribable<string>;
}
export class SurvHeader extends DisplayComponent<MfdSurvHeaderProps> {
    // Make sure to collect all subscriptions here, otherwise page navigation doesn't work.
    private subs = [] as Subscription[];

    private availableSystems = ArraySubject.create([this.props.activeFmsSource.get(), 'ATCCOM', 'SURV', 'FCU BKUP']);

    private sysSelectorSelectedIndex = Subject.create(0);

    private controlsIsSelected = Subject.create(false);

    private statSwitchIsSelected = Subject.create(false);

    public changeSystem(selectedSysIndex: number) {
        this.sysSelectorSelectedIndex.set(selectedSysIndex);

        switch (selectedSysIndex) {
        case 0: // FMS
            this.props.navigateTo('fms/active/init');
            break;
        case 1: // ATCCOM
            this.props.navigateTo('atccom/connect');
            break;
        case 2: // SURV
            this.props.navigateTo('surv/controls');
            break;
        case 3: // FCU BKUP
            this.props.navigateTo('fcubkup/afs');
            break;

        default:
            this.props.navigateTo('fms/active/init');
            break;
        }
    }

    public onAfterRender(node: VNode): void {
        super.onAfterRender(node);

        this.subs.push(this.props.activeFmsSource.sub((val) => {
            this.availableSystems.removeAt(0);
            this.availableSystems.insert(val, 0);
        }, true));

        this.subs.push(this.props.activeUri.sub((val) => {
            switch (val.sys) {
            case 'fms':
                this.sysSelectorSelectedIndex.set(0);
                break;
            case 'atccom':
                this.sysSelectorSelectedIndex.set(1);
                break;
            case 'surv':
                this.sysSelectorSelectedIndex.set(2);
                break;
            case 'fcubkup':
                this.sysSelectorSelectedIndex.set(3);
                break;

            default:
                this.sysSelectorSelectedIndex.set(0);
                break;
            }

            this.controlsIsSelected.set(val.category === 'controls');
            this.statSwitchIsSelected.set(val.category === 'status-switching');
        }, true));
    }

    public destroy(): void {
        // Destroy all subscriptions to remove all references to this instance.
        this.subs.forEach((x) => x.destroy());

        super.destroy();
    }

    render(): VNode {
        return (
            <>
                <div style="display: flex; flex-direction: row; justify-content: space-between;">
                    <DropdownMenu
                        values={this.availableSystems}
                        selectedIndex={this.sysSelectorSelectedIndex}
                        idPrefix="sysSelectorDropdown"
                        freeTextAllowed={false}
                        onModified={(val) => this.changeSystem(val)}
                        containerStyle="width: 25%;"
                        alignLabels="flex-start"
                    />
                    <span class="MFDLabel" style="width: 25%; text-align: left; padding: 8px 10px 0px 10px;">{this.props.callsign}</span>
                </div>
                <div style="display: flex; flex-direction: row; width: 100%">
                    <PageSelectorDropdownMenu
                        isActive={this.controlsIsSelected}
                        label="CONTROLS"
                        menuItems={[{ label: '', action: () => this.props.navigateTo('surv/controls') }]}
                        idPrefix="pageSelectorControls"
                        containerStyle="width: 25%"
                    />
                    <PageSelectorDropdownMenu
                        isActive={this.statSwitchIsSelected}
                        label="STATUS & SWITCHING"
                        menuItems={[{ label: '', action: () => this.props.navigateTo('surv/status-switching') }]}
                        idPrefix="pageSelectorStatSwitch"
                        containerStyle="width: 50%"
                    />
                </div>
            </>
        );
    }
}
