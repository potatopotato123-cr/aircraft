﻿import { DisplayComponent, FSComponent, Subject, Subscribable, VNode } from 'msfssdk';
import './common.scss';

interface DropdownMenuProps {
    values: Subscribable<string[]>;
    selectedIndex: Subscribable<number>;
}
export class DropdownMenu extends DisplayComponent<DropdownMenuProps> {
    private label = Subject.create<string>('X');

    constructor(props: DropdownMenuProps) {
        super(props);

        this.label.set(this.props.values.get()[this.props.selectedIndex.get()]);
    }

    onAfterRender(node: VNode): void {
        super.onAfterRender(node);

        this.props.values.sub((value) => {
            this.label.set(value[this.props.selectedIndex.get()]);
        });

        this.props.selectedIndex.sub((value) => {
            this.label.set(this.props.values.get()[value]);
        });
    }

    render(): VNode {
        return (
            <div class="MFDDropdownOuter">
                <div style="background-color: #040405; display: flex; margin: 4px;">
                    <span class="MFDDropdownLabel">
                        {this.label}
                    </span>
                </div>
                <div style="display: flex; justify-content: center; padding-right: 5px;">
                    <span style="color: white; align-self: center;">
                        <svg height="10" width="10">
                            <polygon points="0,0 10,0 5,10" style="fill: white" />
                        </svg>
                    </span>
                </div>
            </div>
        );
    }
}
