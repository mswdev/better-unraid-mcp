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

export type ParityCheckStatus =
  | 'CANCELLED'
  | 'COMPLETED'
  | 'FAILED'
  | 'NEVER_RUN'
  | 'PAUSED'
  | 'RUNNING';

export type ArrayStatusQueryVariables = Exact<{ [key: string]: never; }>;


export type ArrayStatusQuery = { array: { state: ArrayState, capacity: { kilobytes: { free: string, used: string, total: string } }, parityCheckStatus: { status: ParityCheckStatus, progress: number | null, errors: number | null, running: boolean | null, paused: boolean | null }, parities: Array<{ name: string | null, status: ArrayDiskStatus | null, temp: number | null, type: ArrayDiskType }>, disks: Array<{ name: string | null, status: ArrayDiskStatus | null, temp: number | null, fsFree: string | null, fsUsed: string | null, fsSize: string | null, numErrors: string | null, isSpinning: boolean | null, type: ArrayDiskType }>, caches: Array<{ name: string | null, status: ArrayDiskStatus | null, temp: number | null, fsFree: string | null, fsUsed: string | null, type: ArrayDiskType }> } };

export type ParityHistoryQueryVariables = Exact<{ [key: string]: never; }>;


export type ParityHistoryQuery = { parityHistory: Array<{ date: string | null, duration: number | null, speed: string | null, status: ParityCheckStatus, errors: number | null, correcting: boolean | null }> };

export type DiskListQueryVariables = Exact<{ [key: string]: never; }>;


export type DiskListQuery = { disks: Array<{ device: string, name: string, vendor: string, type: string, size: number, interfaceType: DiskInterfaceType, smartStatus: DiskSmartStatus, temperature: number | null, isSpinning: boolean, serialNum: string, firmwareRevision: string, partitions: Array<{ name: string, fsType: DiskFsType, size: number }> }> };

export type ShareListQueryVariables = Exact<{ [key: string]: never; }>;


export type ShareListQuery = { shares: Array<{ name: string | null, free: string | null, used: string | null, size: string | null, cache: boolean | null, include: Array<string> | null, exclude: Array<string> | null, comment: string | null }> };

export type SystemInfoQueryVariables = Exact<{ [key: string]: never; }>;


export type SystemInfoQuery = { info: { time: string, os: { platform: string | null, distro: string | null, release: string | null, kernel: string | null, uptime: string | null, hostname: string | null }, cpu: { manufacturer: string | null, brand: string | null, cores: number | null, threads: number | null } } };


export const ArrayStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ArrayStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"array"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"capacity"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"kilobytes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"free"}},{"kind":"Field","name":{"kind":"Name","value":"used"}},{"kind":"Field","name":{"kind":"Name","value":"total"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"parityCheckStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"progress"}},{"kind":"Field","name":{"kind":"Name","value":"errors"}},{"kind":"Field","name":{"kind":"Name","value":"running"}},{"kind":"Field","name":{"kind":"Name","value":"paused"}}]}},{"kind":"Field","name":{"kind":"Name","value":"parities"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"temp"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}},{"kind":"Field","name":{"kind":"Name","value":"disks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"temp"}},{"kind":"Field","name":{"kind":"Name","value":"fsFree"}},{"kind":"Field","name":{"kind":"Name","value":"fsUsed"}},{"kind":"Field","name":{"kind":"Name","value":"fsSize"}},{"kind":"Field","name":{"kind":"Name","value":"numErrors"}},{"kind":"Field","name":{"kind":"Name","value":"isSpinning"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}},{"kind":"Field","name":{"kind":"Name","value":"caches"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"temp"}},{"kind":"Field","name":{"kind":"Name","value":"fsFree"}},{"kind":"Field","name":{"kind":"Name","value":"fsUsed"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}}]}}]}}]} as unknown as DocumentNode<ArrayStatusQuery, ArrayStatusQueryVariables>;
export const ParityHistoryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ParityHistory"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"parityHistory"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"date"}},{"kind":"Field","name":{"kind":"Name","value":"duration"}},{"kind":"Field","name":{"kind":"Name","value":"speed"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"errors"}},{"kind":"Field","name":{"kind":"Name","value":"correcting"}}]}}]}}]} as unknown as DocumentNode<ParityHistoryQuery, ParityHistoryQueryVariables>;
export const DiskListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"DiskList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"disks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"device"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"vendor"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"interfaceType"}},{"kind":"Field","name":{"kind":"Name","value":"smartStatus"}},{"kind":"Field","name":{"kind":"Name","value":"temperature"}},{"kind":"Field","name":{"kind":"Name","value":"isSpinning"}},{"kind":"Field","name":{"kind":"Name","value":"serialNum"}},{"kind":"Field","name":{"kind":"Name","value":"firmwareRevision"}},{"kind":"Field","name":{"kind":"Name","value":"partitions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"fsType"}},{"kind":"Field","name":{"kind":"Name","value":"size"}}]}}]}}]}}]} as unknown as DocumentNode<DiskListQuery, DiskListQueryVariables>;
export const ShareListDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ShareList"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"shares"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"free"}},{"kind":"Field","name":{"kind":"Name","value":"used"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"cache"}},{"kind":"Field","name":{"kind":"Name","value":"include"}},{"kind":"Field","name":{"kind":"Name","value":"exclude"}},{"kind":"Field","name":{"kind":"Name","value":"comment"}}]}}]}}]} as unknown as DocumentNode<ShareListQuery, ShareListQueryVariables>;
export const SystemInfoDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SystemInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"info"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"time"}},{"kind":"Field","name":{"kind":"Name","value":"os"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"platform"}},{"kind":"Field","name":{"kind":"Name","value":"distro"}},{"kind":"Field","name":{"kind":"Name","value":"release"}},{"kind":"Field","name":{"kind":"Name","value":"kernel"}},{"kind":"Field","name":{"kind":"Name","value":"uptime"}},{"kind":"Field","name":{"kind":"Name","value":"hostname"}}]}},{"kind":"Field","name":{"kind":"Name","value":"cpu"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"manufacturer"}},{"kind":"Field","name":{"kind":"Name","value":"brand"}},{"kind":"Field","name":{"kind":"Name","value":"cores"}},{"kind":"Field","name":{"kind":"Name","value":"threads"}}]}}]}}]}}]} as unknown as DocumentNode<SystemInfoQuery, SystemInfoQueryVariables>;