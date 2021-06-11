import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Provider as ReduxProvider } from 'react-redux';
import ToolIntroduction from 'app/containers/Calibration/Alignment/ToolIntroduction';
import reduxStore from 'app/store/redux';
import Step from './Step';
import NavigationButtons from './NavigationButtons';
import TriangleDiagram from '../TriangleDiagram';
import Result from './Result';

import styles from './index.styl';
import { step1, step2 } from './data';

const Alignment = ({ onClose }) => {
    const initialShapes = {
        circlePoints: [
            { id: 0, position: 'top', label: '1', show: false },
            { id: 1, position: 'bottom-left', label: '2', show: false },
            { id: 2, position: 'bottom-right', label: '3', show: false },
        ],
        arrows: [
            {
                id: 0,
                position: 'left',
                label: '',
                hasTop: false,
                hasBottom: true,
                show: false
            },
            {
                id: 1,
                position: 'bottom',
                label: '',
                hasTop: true,
                hasBottom: false,
                show: false
            },
            {
                id: 2,
                position: 'diagonal',
                label: '',
                hasTop: true,
                hasBottom: true,
                show: false,
            },
        ],
    };

    const steps = [step1, step2];

    const [currentStep, setCurrentStep] = useState(0);
    const [shapes, setShapes] = useState(initialShapes);
    const [actions, setActions] = useState(steps[currentStep]);
    const [currentAction, setCurrentAction] = useState(0);
    const [stepFinished, setStepFinished] = useState(false);
    const [isFullyComplete, setIsFullyComplete] = useState(false);
    const [introComplete, setIntroComplete] = useState(false);

    const [triangle, setTriangle] = useState({
        a: 0,
        b: 0,
        c: 0,
    });

    const [jogValues, setJogValues] = useState({
        x: 0,
        y: 0,
        z: 0,
    });

    const highlightShapes = () => {
        const foundAction = actions.find(action => action.id === Number(currentAction));

        if (foundAction && foundAction.shapeActions) {
            for (const action of foundAction.shapeActions) {
                const { shapeType, shapeID, isActive, show, clearPrevious, label } = action;

                const foundShapeType = shapes[shapeType];

                if (foundShapeType) {
                    if (clearPrevious) {
                        setShapes((prev) => {
                            const updated = prev[shapeType].map(shape => (
                                shape.id === shapeID
                                    ? { ...shape, label, isActive, show }
                                    : { ...shape, isActive: false }
                            ));
                            return ({
                                ...prev,
                                arrows: prev.arrows.map(arrow => ({ ...arrow, isActive: false })),
                                circlePoints: prev.circlePoints.map(point => ({ ...point, isActive: false })),
                                [shapeType]: updated,
                            });
                        });
                    } else {
                        setShapes((prev) => {
                            const updated = prev[shapeType].map(shape => (shape.id === shapeID ? { ...shape, label, isActive, show } : shape));
                            return ({
                                ...prev,
                                [shapeType]: updated,
                            });
                        });
                    }
                }
            }
        } else {
            setShapes((prev) => ({
                ...prev,
                circlePoints: prev.circlePoints.map(point => ({ ...point, isActive: false })),
                arrows: prev.arrows.map(arrow => ({ ...arrow, isActive: false })),
            }));
        }
    };

    useEffect(() => {
        highlightShapes();
    }, [currentAction, currentStep]);

    useEffect(() => {
        const isFinished = actions.every((action) => action.checked);

        if (isFinished) {
            setStepFinished(true);
        }
    }, [actions]);

    const onChange = ({ id, checked, axis, value }) => {
        const foundAction = actions.find(action => action.id === Number(id));

        if (foundAction && foundAction.hasBeenChanged) {
            return;
        }

        if (axis && value) {
            setJogValues((prev) => ({ ...prev, [axis]: Number(value) }));
        }

        const updatedActions = actions.map(action => (
            action.id === id
                ? ({ ...action, checked, hasBeenChanged: true })
                : action
        ));
        setCurrentAction(id + 1);

        setActions(updatedActions);
    };

    const handleTriangleChange = ({ id, value }) => {
        setTriangle(prev => ({ ...prev, [id]: value }));
    };

    const next = () => {
        const nextStep = currentStep + 1;
        if (steps[nextStep]) {
            setActions(steps[nextStep]);
            setCurrentAction(0);
            setShapes(initialShapes);
            setCurrentStep(nextStep);
            setStepFinished(false);
        } else {
            setIsFullyComplete(true);
        }
    };

    const prev = () => {
        const prevStep = currentStep - 1;
        if (steps[prevStep]) {
            setActions(steps[prevStep]);
            setCurrentAction(0);
            setShapes(initialShapes);
            setCurrentStep(prevStep);
            setStepFinished(false);
        }
    };

    const onBack = () => {
        setIsFullyComplete(false);
    };

    const startTool = () => {
        setIntroComplete(true);
    };

    const actionData = actions.find(action => action.id === currentAction);

    const prevDisabled = !!steps[currentStep - 1];
    const nextDisabled = stepFinished;

    return (
        <ReduxProvider store={reduxStore}>
            {
                isFullyComplete
                    ? <Result triangle={triangle} jogValues={jogValues} onBack={onBack} onClose={onClose} />
                    : (
                        <div className={styles.alignmentContainer}>
                            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                <div>
                                    <h4 style={{ marginTop: 0 }}>Alignment</h4>
                                    {
                                        !introComplete && <ToolIntroduction readyHandler={startTool} />
                                    }
                                    {
                                        introComplete && (
                                            <Step
                                                actions={actions}
                                                onChange={onChange}
                                                currentAction={currentAction}
                                            />
                                        )
                                    }
                                </div>

                                {
                                    introComplete && (
                                        <NavigationButtons
                                            onNext={next}
                                            onPrevious={prev}
                                            prevDisabled={prevDisabled}
                                            nextDisabled={nextDisabled}
                                        />
                                    )
                                }
                            </div>

                            <div style={{ justifyContent: 'space-between', padding: '3rem', display: 'flex', gap: '1rem', flexDirection: 'column', width: '100%', backgroundColor: 'white' }}>
                                <TriangleDiagram
                                    circlePoints={shapes.circlePoints}
                                    arrows={shapes.arrows}
                                    triangle={triangle}
                                    onTriangleChange={handleTriangleChange}
                                />

                                <p style={{ width: '100%', fontWeight: 'bold' }}>{stepFinished ? 'Proceed to the Next Step' : actionData?.description}</p>
                            </div>
                        </div>
                    )
            }
        </ReduxProvider>
    );
}; Alignment.propTypes = { step: PropTypes.object };

export default Alignment;