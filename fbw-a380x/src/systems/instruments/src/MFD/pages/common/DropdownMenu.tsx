import { ComponentProps, DisplayComponent, FSComponent, Subject, SubscribableArray, Subscription, VNode } from '@microsoft/msfs-sdk';
import './style.scss';
import { InputField } from 'instruments/src/MFD/pages/common/InputField';
import { DropdownFieldFormat } from 'instruments/src/MFD/pages/common/DataEntryFormats';

interface DropdownMenuProps extends ComponentProps {
    values: SubscribableArray<string>;
    selectedIndex: Subject<number>;
    freeTextAllowed: boolean;
    idPrefix: string;
    /**
     *
     * If defined, this component does not update the selectedIndex prop, but rather calls this method.
     */
    onModified?: (newSelectedIndex: number, freeTextEntry: string) => void;
    containerStyle?: string;
    alignLabels?: 'flex-start' | 'center' | 'flex-end';
    numberOfDigitsForInputField?: number;
}

export class DropdownMenu extends DisplayComponent<DropdownMenuProps> {
    // Make sure to collect all subscriptions here, otherwise page navigation doesn't work.
    private subs = [] as Subscription[];

    private label = Subject.create('NOT SET');

    private topRef = FSComponent.createRef<HTMLDivElement>();

    private dropdownSelectorRef = FSComponent.createRef<HTMLDivElement>();

    // private dropdownSelectorLabelRef = FSComponent.createRef<HTMLSpanElement>();

    private dropdownMenuRef = FSComponent.createRef<HTMLDivElement>();

    private dropdownIsOpened = Subject.create(false);

    private inputFieldRef = FSComponent.createRef<InputField<string>>();

    private inputFieldValue = Subject.create<string>('');

    private freeTextEntered = false;

    clickHandler(i: number, thisArg: DropdownMenu) {
        this.freeTextEntered = false;
        if (thisArg.props.onModified) {
            thisArg.props.onModified(i, '');
        } else {
            thisArg.props.selectedIndex.set(i);
        }
        thisArg.dropdownIsOpened.set(false);
    }

    private onFieldSubmit(text: string) {
        if (this.props.freeTextAllowed && this.props.onModified) {
            // selected index of -1 marks free text entry
            this.props.onModified(-1, text);

            this.dropdownMenuRef.instance.style.display = 'none';
            this.freeTextEntered = true;
            this.inputFieldValue.set(text);
            this.dropdownIsOpened.set(false);
            this.freeTextEntered = false;
        }
    }

    private onFieldChanged(_text: string) {
        this.freeTextEntered = true;
    }

    onAfterRender(node: VNode): void {
        super.onAfterRender(node);

        this.subs.push(this.props.values.sub((value, type, item, array) => {
            // this.label.set(array[this.props.selectedIndex.get()]);
            this.inputFieldValue.set(array[this.props.selectedIndex.get()]);

            // Remove click handlers
            this.props.values.getArray().forEach((val, i) => {
                if (document.getElementById(`${this.props.idPrefix}_${i}`)) {
                    document.getElementById(`${this.props.idPrefix}_${i}`).removeEventListener('click', () => this.clickHandler(i, this));
                }
            });

            // Re-draw all options
            while (this.dropdownMenuRef.instance.firstChild) {
                this.dropdownMenuRef.instance.removeChild(this.dropdownMenuRef.instance.firstChild);
            }
            this.props.values.getArray().forEach((el, idx) => {
                const n: VNode = (
                    <span
                        id={`${this.props.idPrefix}_${idx}`}
                        class="MFDDropdownMenuElement"
                        style={`text-align: ${this.props.alignLabels};`}
                    >
                        {el}
                    </span>
                );
                FSComponent.render(n, this.dropdownMenuRef.instance);
            }, this);
            //

            // Add click handlers
            this.props.values.getArray().forEach((val, i) => {
                document.getElementById(`${this.props.idPrefix}_${i}`).addEventListener('click', () => this.clickHandler(i, this));
            });
        }, true));

        this.subs.push(this.props.selectedIndex.sub((value) => {
            // this.label.set(this.props.values.get(value));
            this.inputFieldValue.set(this.props.values.get(value));
        }));

        this.dropdownSelectorRef.instance.addEventListener('click', () => {
            this.dropdownIsOpened.set(!this.dropdownIsOpened.get());
        });

        // Close dropdown menu if clicked outside
        document.getElementById('MFD_CONTENT').addEventListener('click', (e) => {
            if (!this.topRef.getOrDefault().contains(e.target as Node) && this.dropdownIsOpened.get() === true) {
                this.dropdownIsOpened.set(false);
            }
        });

        this.subs.push(this.dropdownIsOpened.sub((val) => {
            this.dropdownMenuRef.instance.style.display = val ? 'block' : 'none';

            if (!this.freeTextEntered) {
                if (val === true) {
                    this.inputFieldRef.instance.textInputRef.instance.focus();
                    this.inputFieldRef.instance.onFocus();
                } else {
                    this.inputFieldRef.instance.textInputRef.instance.blur();
                    this.inputFieldRef.instance.onBlur(false);
                }
            }
            // this.dropdownSelectorLabelRef.instance.classList.toggle('opened');
        }));

        // TODO add mouse wheel and key events
    }

    public destroy(): void {
        // Destroy all subscriptions to remove all references to this instance.
        this.subs.forEach((x) => x.destroy());

        super.destroy();
    }

    render(): VNode {
        return (
            <div class="MFDDropdownContainer" ref={this.topRef} style={this.props.containerStyle}>
                <div ref={this.dropdownSelectorRef} class="MFDDropdownOuter">
                    <div class="MFDDropdownInner" style={`justify-content: ${this.props.alignLabels};`}>
                        <InputField<string>
                            ref={this.inputFieldRef}
                            dataEntryFormat={new DropdownFieldFormat(this.props.numberOfDigitsForInputField ?? 6)}
                            value={this.inputFieldValue}
                            containerStyle="border: 2px inset transparent"
                            alignText={this.props.alignLabels}
                            onModified={(text) => this.onFieldSubmit(text)}
                            onInput={(text) => this.onFieldChanged(text)}
                            handleFocusBlurExternally
                        />
                        {/* <span ref={this.dropdownSelectorLabelRef} class="MFDDropdownLabel">
                            {this.label}
        </span> */ }
                    </div>
                    <div style="display: flex; justify-content: center; align-items: center; width: 25px;">
                        <svg height="15" width="15">
                            <polygon points="0,0 15,0 7.5,15" style="fill: white" />
                        </svg>
                    </div>
                </div>
                <div ref={this.dropdownMenuRef} class="MFDDropdownMenu" style={`display: ${this.dropdownIsOpened.get() ? 'block' : 'none'}`} />
            </div>
        );
    }
}
