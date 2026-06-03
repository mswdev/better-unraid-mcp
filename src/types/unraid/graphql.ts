/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type ArrayDiskStatus =
  | 'DISK_DSBL'
  | 'DISK_DSBL_NEW'
  | 'DISK_INVALID'
  | 'DISK_NEW'
  | 'DISK_NP'
  | 'DISK_NP_DSBL'
  | 'DISK_NP_MISSING'
  | 'DISK_OK'
  | 'DISK_WRONG';

export type ArrayDiskType =
  | 'BOOT'
  | 'CACHE'
  | 'DATA'
  | 'FLASH'
  | 'PARITY';

export type ArrayState =
  | 'DISABLE_DISK'
  | 'INVALID_EXPANSION'
  | 'NEW_ARRAY'
  | 'NEW_DISK_TOO_SMALL'
  | 'NO_DATA_DISKS'
  | 'PARITY_NOT_BIGGEST'
  | 'RECON_DISK'
  | 'STARTED'
  | 'STOPPED'
  | 'SWAP_DSBL'
  | 'TOO_MANY_MISSING_DISKS';

export type ContainerPortType =
  | 'TCP'
  | 'UDP';

export type ContainerState =
  | 'EXITED'
  | 'PAUSED'
  | 'RUNNING';

/** The type of filesystem on the disk partition */
export type DiskFsType =
  | 'BTRFS'
  | 'EXT4'
  | 'NTFS'
  | 'VFAT'
  | 'XFS'
  | 'ZFS';

/** The type of interface the disk uses to connect to the system */
export type DiskInterfaceType =
  | 'PCIE'
  | 'SAS'
  | 'SATA'
  | 'UNKNOWN'
  | 'USB';

/** The SMART (Self-Monitoring, Analysis and Reporting Technology) status of the disk */
export type DiskSmartStatus =
  | 'OK'
  | 'UNKNOWN';

export type DockerAutostartEntryInput = {
  /** Whether the container should auto-start */
  autoStart: boolean;
  /** Docker container identifier */
  id: string;
  /** Number of seconds to wait after starting the container */
  wait?: number | null | undefined;
};

export type ParityCheckStatus =
  | 'CANCELLED'
  | 'COMPLETED'
  | 'FAILED'
  | 'NEVER_RUN'
  | 'PAUSED'
  | 'RUNNING';

/** The state of a virtual machine */
export type VmState =
  | 'CRASHED'
  | 'IDLE'
  | 'NOSTATE'
  | 'PAUSED'
  | 'PMSUSPENDED'
  | 'RUNNING'
  | 'SHUTDOWN'
  | 'SHUTOFF';

export type ArrayStatusQueryVariables = Exact<{ [key: string]: never; }>;


export type ArrayStatusQuery = { array: { state: ArrayState, capacity: { kilobytes: { free: string, used: string, total: string } }, parityCheckStatus: { status: ParityCheckStatus, progress: number | null, errors: number | null, running: boolean | null, paused: boolean | null }, parities: Array<{ name: string | null, status: ArrayDiskStatus | null, temp: number | null, type: ArrayDiskType }>, disks: Array<{ name: string | null, status: ArrayDiskStatus | null, temp: number | null, fsFree: string | null, fsUsed: string | null, fsSize: string | null, numErrors: string | null, isSpinning: boolean | null, type: ArrayDiskType }>, caches: Array<{ name: string | null, status: ArrayDiskStatus | null, temp: number | null, fsFree: string | null, fsUsed: string | null, type: ArrayDiskType }> } };

export type ParityHistoryQueryVariables = Exact<{ [key: string]: never; }>;


export type ParityHistoryQuery = { parityHistory: Array<{ date: string | null, duration: number | null, speed: string | null, status: ParityCheckStatus, errors: number | null, correcting: boolean | null }> };

export type DiskListQueryVariables = Exact<{ [key: string]: never; }>;


export type DiskListQuery = { disks: Array<{ device: string, name: string, vendor: string, type: string, size: number, interfaceType: DiskInterfaceType, smartStatus: DiskSmartStatus, temperature: number | null, isSpinning: boolean, serialNum: string, firmwareRevision: string, partitions: Array<{ name: string, fsType: DiskFsType, size: number }> }> };

export type DockerAutostartStateQueryVariables = Exact<{ [key: string]: never; }>;


export type DockerAutostartStateQuery = { docker: { containers: Array<{ id: string, names: Array<string>, autoStart: boolean, autoStartOrder: number | null, autoStartWait: number | null }> } };

export type DockerSetAutostartMutationVariables = Exact<{
  entries: Array<DockerAutostartEntryInput> | DockerAutostartEntryInput;
  persist?: boolean | null | undefined;
}>;


export type DockerSetAutostartMutation = { docker: { updateAutostartConfiguration: boolean } };

export type DockerStartMutationVariables = Exact<{
  id: string;
}>;


export type DockerStartMutation = { docker: { start: { id: string, names: Array<string>, state: ContainerState, status: string } } };

export type DockerStopMutationVariables = Exact<{
  id: string;
}>;


export type DockerStopMutation = { docker: { stop: { id: string, names: Array<string>, state: ContainerState, status: string } } };

export type DockerPauseMutationVariables = Exact<{
  id: string;
}>;


export type DockerPauseMutation = { docker: { pause: { id: string, names: Array<string>, state: ContainerState, status: string } } };

export type DockerUnpauseMutationVariables = Exact<{
  id: string;
}>;


export type DockerUnpauseMutation = { docker: { unpause: { id: string, names: Array<string>, state: ContainerState, status: string } } };

export type DockerContainerListQueryVariables = Exact<{ [key: string]: never; }>;


export type DockerContainerListQuery = { docker: { containers: Array<{ id: string, names: Array<string>, image: string, state: ContainerState, status: string, autoStart: boolean, isUpdateAvailable: boolean | null }> } };

export type DockerContainerLogsQueryVariables = Exact<{
  id: string;
  since?: string | null | undefined;
  tail?: number | null | undefined;
}>;


export type DockerContainerLogsQuery = { docker: { logs: { containerId: string, cursor: string | null, lines: Array<{ timestamp: string, message: string }> } } };

export type DockerRemoveContainerMutationVariables = Exact<{
  id: string;
  withImage?: boolean | null | undefined;
}>;


export type DockerRemoveContainerMutation = { docker: { removeContainer: boolean } };

export type DockerUpdateContainersMutationVariables = Exact<{
  ids: Array<string> | string;
}>;


export type DockerUpdateContainersMutation = { docker: { updateContainers: Array<{ id: string, names: Array<string>, state: ContainerState, status: string, isUpdateAvailable: boolean | null }> } };

export type DockerUpdateAllMutationVariables = Exact<{ [key: string]: never; }>;


export type DockerUpdateAllMutation = { docker: { updateAllContainers: Array<{ id: string, names: Array<string>, state: ContainerState, status: string }> } };

export type DockerNetworkListQueryVariables = Exact<{ [key: string]: never; }>;


export type DockerNetworkListQuery = { docker: { networks: Array<{ id: string, name: string, driver: string, scope: string, enableIPv6: boolean, internal: boolean, attachable: boolean }> } };

export type DockerPortConflictsQueryVariables = Exact<{ [key: string]: never; }>;


export type DockerPortConflictsQuery = { docker: { portConflicts: { containerPorts: Array<{ privatePort: number, type: ContainerPortType, containers: Array<{ id: string, name: string }> }>, lanPorts: Array<{ lanIpPort: string, publicPort: number | null, type: ContainerPortType, containers: Array<{ id: string, name: string }> }> } } };

export type ShareListQueryVariables = Exact<{ [key: string]: never; }>;


export type ShareListQuery = { shares: Array<{ name: string | null, free: string | null, used: string | null, size: string | null, cache: boolean | null, include: Array<string> | null, exclude: Array<string> | null, comment: string | null }> };

export type SystemInfoQueryVariables = Exact<{ [key: string]: never; }>;


export type SystemInfoQuery = { info: { time: string, os: { platform: string | null, distro: string | null, release: string | null, kernel: string | null, uptime: string | null, hostname: string | null }, cpu: { manufacturer: string | null, brand: string | null, cores: number | null, threads: number | null } } };

export type VmResolveQueryVariables = Exact<{ [key: string]: never; }>;


export type VmResolveQuery = { vms: { domains: Array<{ id: string, name: string | null }> | null } };

export type VmStartMutationVariables = Exact<{
  id: string;
}>;


export type VmStartMutation = { vm: { start: boolean } };

export type VmStopMutationVariables = Exact<{
  id: string;
}>;


export type VmStopMutation = { vm: { stop: boolean } };

export type VmPauseMutationVariables = Exact<{
  id: string;
}>;


export type VmPauseMutation = { vm: { pause: boolean } };

export type VmResumeMutationVariables = Exact<{
  id: string;
}>;


export type VmResumeMutation = { vm: { resume: boolean } };

export type VmForceStopMutationVariables = Exact<{
  id: string;
}>;


export type VmForceStopMutation = { vm: { forceStop: boolean } };

export type VmRebootMutationVariables = Exact<{
  id: string;
}>;


export type VmRebootMutation = { vm: { reboot: boolean } };

export type VmResetMutationVariables = Exact<{
  id: string;
}>;


export type VmResetMutation = { vm: { reset: boolean } };

export type VmListQueryVariables = Exact<{ [key: string]: never; }>;


export type VmListQuery = { vms: { domains: Array<{ id: string, name: string | null, state: VmState }> | null } };


export const ArrayStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ArrayStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"array"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"capacity"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"kilobytes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"free"}},{"kind":"Field","name":{"kind":"Name","value":"used"}},{"kind":"Field","name":{"kind":"Name","value":"total"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"parityCheckStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"progress"}},{"kind":"Field","name":{"kind":"Name","value":"errors"}},{"kind":"Field","name":{"kind":"Name","value":"running"}},{"kind":"Field","name":{"kind":"Name","value":"paused"}}]}},{"kind":"Field","name":{"kind":"Name","value":"parities"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"temp"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}},{"kind":"Field","name":{"kind":"Name","value":"disks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"temp"}},{"kind":"Field","name":{"kind":"Name","value":"fsFree"}},{"kind":"Field","name":{"kind":"Name","value":"fsUsed"}},{"kind":"Field","name":{"kind":"Name","value":"fsSize"}},{"kind":"Field","name":{"kind":"Name","value":"numErrors"}},{"kind":"Field","name":{"kind":"Name","value":"isSpinning"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}},{"kind":"Field","name":{"kind":"Name","value":"caches"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"temp"}},{"kind":"Field","name":{"kind":"Name","value":"fsFree"}},{"kind":"Field","name":{"kind":"Name","value":"fsUsed"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}}]}}]}}]} as unknown as DocumentNode<ArrayStatusQuery, ArrayStatusQueryVariables>;
export const ParityHistoryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ParityHistory"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"parityHistory"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"date"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"speed"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"errors"}},{"kind":"Field","name":{"kind":"Name","value":"correcting"}}]}}]}}]} as unknown as DocumentNode<ParityHistoryQuery, ParityHistoryQueryVariables>;
export const DiskListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"DiskList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"disks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"device"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"vendor"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"interfaceType"}},{"kind":"Field","name":{"kind":"Name","value":"smartStatus"}},{"kind":"Field","name":{"kind":"Name","value":"temperature"}},{"kind":"Field","name":{"kind":"Name","value":"isSpinning"}},{"kind":"Field","name":{"kind":"Name","value":"serialNum"}},{"kind":"Field","name":{"kind":"Name","value":"firmwareRevision"}},{"kind":"Field","name":{"kind":"Name","value":"partitions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"fsType"}},{"kind":"Field","name":{"kind":"Name","value":"size"}}]}}]}}]}}]} as unknown as DocumentNode<DiskListQuery, DiskListQueryVariables>;
export const DockerAutostartStateDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"DockerAutostartState"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"docker"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"containers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"names"}},{"kind":"Field","name":{"kind":"Name","value":"autoStart"}},{"kind":"Field","name":{"kind":"Name","value":"autoStartOrder"}},{"kind":"Field","name":{"kind":"Name","value":"autoStartWait"}}]}}]}}]}}]} as unknown as DocumentNode<DockerAutostartStateQuery, DockerAutostartStateQueryVariables>;
export const DockerSetAutostartDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DockerSetAutostart"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"entries"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"DockerAutostartEntryInput"}}}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"persist"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"docker"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateAutostartConfiguration"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"entries"},"value":{"kind":"Variable","name":{"kind":"Name","value":"entries"}}},{"kind":"Argument","name":{"kind":"Name","value":"persistUserPreferences"},"value":{"kind":"Variable","name":{"kind":"Name","value":"persist"}}}]}]}}]}}]} as unknown as DocumentNode<DockerSetAutostartMutation, DockerSetAutostartMutationVariables>;
export const DockerStartDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DockerStart"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PrefixedID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"docker"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"start"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"names"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]} as unknown as DocumentNode<DockerStartMutation, DockerStartMutationVariables>;
export const DockerStopDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DockerStop"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PrefixedID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"docker"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"stop"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"names"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]} as unknown as DocumentNode<DockerStopMutation, DockerStopMutationVariables>;
export const DockerPauseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DockerPause"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PrefixedID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"docker"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"pause"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"names"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]} as unknown as DocumentNode<DockerPauseMutation, DockerPauseMutationVariables>;
export const DockerUnpauseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DockerUnpause"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PrefixedID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"docker"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"unpause"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"names"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]} as unknown as DocumentNode<DockerUnpauseMutation, DockerUnpauseMutationVariables>;
export const DockerContainerListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"DockerContainerList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"docker"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"containers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"names"}},{"kind":"Field","name":{"kind":"Name","value":"image"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"autoStart"}},{"kind":"Field","name":{"kind":"Name","value":"isUpdateAvailable"}}]}}]}}]}}]} as unknown as DocumentNode<DockerContainerListQuery, DockerContainerListQueryVariables>;
export const DockerContainerLogsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"DockerContainerLogs"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PrefixedID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"since"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"DateTime"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"tail"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"docker"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"logs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"since"},"value":{"kind":"Variable","name":{"kind":"Name","value":"since"}}},{"kind":"Argument","name":{"kind":"Name","value":"tail"},"value":{"kind":"Variable","name":{"kind":"Name","value":"tail"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"containerId"}},{"kind":"Field","name":{"kind":"Name","value":"lines"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"message"}}]}},{"kind":"Field","name":{"kind":"Name","value":"cursor"}}]}}]}}]}}]} as unknown as DocumentNode<DockerContainerLogsQuery, DockerContainerLogsQueryVariables>;
export const DockerRemoveContainerDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DockerRemoveContainer"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PrefixedID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"withImage"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Boolean"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"docker"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"removeContainer"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"withImage"},"value":{"kind":"Variable","name":{"kind":"Name","value":"withImage"}}}]}]}}]}}]} as unknown as DocumentNode<DockerRemoveContainerMutation, DockerRemoveContainerMutationVariables>;
export const DockerUpdateContainersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DockerUpdateContainers"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"ids"}},"type":{"kind":"NonNullType","type":{"kind":"ListType","type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PrefixedID"}}}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"docker"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateContainers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"ids"},"value":{"kind":"Variable","name":{"kind":"Name","value":"ids"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"names"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"isUpdateAvailable"}}]}}]}}]}}]} as unknown as DocumentNode<DockerUpdateContainersMutation, DockerUpdateContainersMutationVariables>;
export const DockerUpdateAllDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DockerUpdateAll"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"docker"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateAllContainers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"names"}},{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]}}]} as unknown as DocumentNode<DockerUpdateAllMutation, DockerUpdateAllMutationVariables>;
export const DockerNetworkListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"DockerNetworkList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"docker"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"networks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"driver"}},{"kind":"Field","name":{"kind":"Name","value":"scope"}},{"kind":"Field","name":{"kind":"Name","value":"enableIPv6"}},{"kind":"Field","name":{"kind":"Name","value":"internal"}},{"kind":"Field","name":{"kind":"Name","value":"attachable"}}]}}]}}]}}]} as unknown as DocumentNode<DockerNetworkListQuery, DockerNetworkListQueryVariables>;
export const DockerPortConflictsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"DockerPortConflicts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"docker"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"portConflicts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"containerPorts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"privatePort"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"containers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"lanPorts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"lanIpPort"}},{"kind":"Field","name":{"kind":"Name","value":"publicPort"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"containers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<DockerPortConflictsQuery, DockerPortConflictsQueryVariables>;
export const ShareListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ShareList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"shares"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"free"}},{"kind":"Field","name":{"kind":"Name","value":"used"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"cache"}},{"kind":"Field","name":{"kind":"Name","value":"include"}},{"kind":"Field","name":{"kind":"Name","value":"exclude"}},{"kind":"Field","name":{"kind":"Name","value":"comment"}}]}}]}}]} as unknown as DocumentNode<ShareListQuery, ShareListQueryVariables>;
export const SystemInfoDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SystemInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"info"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"time"}},{"kind":"Field","name":{"kind":"Name","value":"os"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"platform"}},{"kind":"Field","name":{"kind":"Name","value":"distro"}},{"kind":"Field","name":{"kind":"Name","value":"release"}},{"kind":"Field","name":{"kind":"Name","value":"kernel"}},{"kind":"Field","name":{"kind":"Name","value":"uptime"}},{"kind":"Field","name":{"kind":"Name","value":"hostname"}}]}},{"kind":"Field","name":{"kind":"Name","value":"cpu"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"manufacturer"}},{"kind":"Field","name":{"kind":"Name","value":"brand"}},{"kind":"Field","name":{"kind":"Name","value":"cores"}},{"kind":"Field","name":{"kind":"Name","value":"threads"}}]}}]}}]}}]} as unknown as DocumentNode<SystemInfoQuery, SystemInfoQueryVariables>;
export const VmResolveDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"VmResolve"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"vms"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"domains"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]} as unknown as DocumentNode<VmResolveQuery, VmResolveQueryVariables>;
export const VmStartDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"VmStart"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PrefixedID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"vm"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"start"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]}}]} as unknown as DocumentNode<VmStartMutation, VmStartMutationVariables>;
export const VmStopDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"VmStop"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PrefixedID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"vm"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"stop"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]}}]} as unknown as DocumentNode<VmStopMutation, VmStopMutationVariables>;
export const VmPauseDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"VmPause"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PrefixedID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"vm"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"pause"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]}}]} as unknown as DocumentNode<VmPauseMutation, VmPauseMutationVariables>;
export const VmResumeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"VmResume"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PrefixedID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"vm"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"resume"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]}}]} as unknown as DocumentNode<VmResumeMutation, VmResumeMutationVariables>;
export const VmForceStopDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"VmForceStop"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PrefixedID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"vm"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"forceStop"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]}}]} as unknown as DocumentNode<VmForceStopMutation, VmForceStopMutationVariables>;
export const VmRebootDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"VmReboot"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PrefixedID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"vm"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reboot"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]}}]} as unknown as DocumentNode<VmRebootMutation, VmRebootMutationVariables>;
export const VmResetDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"VmReset"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"PrefixedID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"vm"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"reset"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]}}]} as unknown as DocumentNode<VmResetMutation, VmResetMutationVariables>;
export const VmListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"VmList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"vms"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"domains"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"state"}}]}}]}}]}}]} as unknown as DocumentNode<VmListQuery, VmListQueryVariables>;