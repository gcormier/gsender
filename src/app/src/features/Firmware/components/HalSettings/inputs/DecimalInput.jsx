import React from 'react';

import ControlledInput from './ControlledInput';

import styles from './index.module.styl';

const DecimalInput = ({ info, setting, onChange, disabled }) => {
    const { unit = null } = info;
    let { value } = setting;
    value = Number(value);

    return (
        <div className={styles.inputRow}>
            <ControlledInput
                type="decimal"
                className={styles.textInput}
                value={value}
                externalOnChange={onChange}
                disabled={disabled}
            />
            {unit && <span className={styles.unit}>{unit}</span>}
        </div>
    );
};

export default DecimalInput;
