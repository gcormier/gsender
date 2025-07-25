import { FirmwareFlavour } from 'app/features/Connection';

interface ConnectionInfoProps {
    firmwareType: FirmwareFlavour;
    port: string;
}

export function ConnectionInfo(props: ConnectionInfoProps) {
    const { port } = props;
    const truncatedPort = port.replace('/dev/tty.usbmodem', '');
    return (
        <div className="flex flex-col gap-1 font-normal justify-end text-right max-sm:hidden">
            <div className="font-bold text-gray-900 dark:text-gray-100">
                {truncatedPort}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
                {props.firmwareType}
            </div>
        </div>
    );
}
