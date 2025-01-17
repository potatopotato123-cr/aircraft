// Copyright (c) 2023-2024 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import { ChecklistDefinition } from '../Checklists';

export const approachChecklist: ChecklistDefinition = {
    name: 'APPROACH',
    items: [
        {
            item: 'BARO REF',
            result: '_____SET (BOTH)',
        },
        {
            item: 'SEAT BELTS',
            result: 'ON',
            condition: () => !!SimVar.GetSimVarValue('CABIN SEATBELTS ALERT SWITCH', 'Number'),
        },
        {
            item: 'MINIMUM',
            result: '_____',
        },
        {
            item: 'AUTO BRAKE',
            result: '_____',
        },
        {
            item: 'ENG MODE SEL',
            result: '_____',
        },
    ],
};
