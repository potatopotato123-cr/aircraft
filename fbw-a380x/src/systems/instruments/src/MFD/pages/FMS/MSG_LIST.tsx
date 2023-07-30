/* eslint-disable jsx-a11y/label-has-associated-control */

import { DisplayComponent, FSComponent, Subject, SubscribableArray, SubscribableArrayEventType, Subscription, VNode } from '@microsoft/msfs-sdk';

import './msg_list.scss';
import { ActivePageTitleBar } from 'instruments/src/MFD/pages/common/ActivePageTitleBar';
import { MfdComponentProps } from 'instruments/src/MFD/MFD';
import { Footer } from 'instruments/src/MFD/pages/common/Footer';
import { Button } from 'instruments/src/MFD/pages/common/Button';

interface MfdMsgListProps extends MfdComponentProps {
    messages: SubscribableArray<string>;
}

export class MfdMsgList extends DisplayComponent<MfdMsgListProps> {
    // Make sure to collect all subscriptions here, otherwise page navigation doesn't work.
    private subs = [] as Subscription[];

    private msgListContainer = FSComponent.createRef<HTMLDivElement>();

    public onAfterRender(node: VNode): void {
        super.onAfterRender(node);

        this.subs.push(this.props.messages.sub((idx, type, item, arr) => {
            if (arr.length > 5) {
                console.warn('More than 5 FMS messages, truncating.');
            }

            // Updating container children
            // TODO check if more sanity checks required on index and length
            if (type === SubscribableArrayEventType.Cleared) {
                while (this.msgListContainer.instance.firstChild) {
                    this.msgListContainer.instance.removeChild(this.msgListContainer.instance.firstChild);

                    // Display previously truncated message
                    if (arr.length >= 5) {
                        this.msgListContainer.instance.appendChild(<div class="MFDLabel msgListElement">{arr[4]}</div>);
                    }
                }
            } else if (type === SubscribableArrayEventType.Removed) {
                this.msgListContainer.instance.removeChild(this.msgListContainer.instance.children[idx]);
            } else {
                // Add element
                this.msgListContainer.instance.children[idx].after(<div class="MFDLabel msgListElement">{item}</div>);
            }
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
                <ActivePageTitleBar activePage={Subject.create('MESSAGES LIST')} offset={Subject.create('')} eoIsActive={Subject.create(false)} tmpyIsActive={Subject.create(false)} />
                {/* begin page content */}
                <div class="MFDPageContainer">
                    <div ref={this.msgListContainer} class="msgListElementContainer">
                        {this.props.messages.getArray().map((val, idx) => {
                            if (idx > 4) {
                                return null;
                            }

                            return (<div class="MFDLabel msgListElement">{val}</div>);
                        })}
                    </div>
                    <div style="flex-grow: 1;" />
                    <div style="display: flex; justify-content: flex-start;">
                        <Button label="CLOSE" onClick={() => this.props.navigateTo('back')} />
                    </div>
                </div>
                {/* end page content */}
                <Footer bus={this.props.bus} activeUri={this.props.activeUri} navigateTo={this.props.navigateTo} />
            </>
        );
    }
}
