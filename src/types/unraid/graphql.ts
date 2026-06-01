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

export type ParityCheckStatus =
  | 'CANCELLED'
  | 'COMPLETED'
  | 'FAILED'
  | 'NEVER_RUN'
  | 'PAUSED'
  | 'RUNNING';

export type ArrayStatusQueryVariables = Exact<{ [key: string]: never; }>;


export type ArrayStatusQuery = { array: { state: ArrayState, capacity: { kilobytes: { free: string, used: string, total: string } }, parityCheckStatus: { status: ParityCheckStatus, progress: number | null, errors: number | null, running: boolean | null, paused: boolean | null }, parities: Array<{ name: string | null, status: ArrayDiskStatus | null, temp: number | null, type: ArrayDiskType }>, disks: Array<{ name: string | null, status: ArrayDiskStatus | null, temp: number | null, fsFree: string | null, fsUsed: string | null, fsSize: string | null, numErrors: string | null, isSpinning: boolean | null, type: ArrayDiskType }>, caches: Array<{ name: string | null, status: ArrayDiskStatus | null, temp: number | null, fsFree: string | null, fsUsed: string | null, type: ArrayDiskType }> } };

export type SystemInfoQueryVariables = Exact<{ [key: string]: never; }>;


export type SystemInfoQuery = { info: { time: string, os: { platform: string | null, distro: string | null, release: string | null, kernel: string | null, uptime: string | null, hostname: string | null }, cpu: { manufacturer: string | null, brand: string | null, cores: number | null, threads: number | null } } };


export const ArrayStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ArrayStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"array"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"state"}},{"kind":"Field","name":{"kind":"Name","value":"capacity"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"kilobytes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"free"}},{"kind":"Field","name":{"kind":"Name","value":"used"}},{"kind":"Field","name":{"kind":"Name","value":"total"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"parityCheckStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"progress"}},{"kind":"Field","name":{"kind":"Name","value":"errors"}},{"kind":"Field","name":{"kind":"Name","value":"running"}},{"kind":"Field","name":{"kind":"Name","value":"paused"}}]}},{"kind":"Field","name":{"kind":"Name","value":"parities"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"temp"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}},{"kind":"Field","name":{"kind":"Name","value":"disks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"temp"}},{"kind":"Field","name":{"kind":"Name","value":"fsFree"}},{"kind":"Field","name":{"kind":"Name","value":"fsUsed"}},{"kind":"Field","name":{"kind":"Name","value":"fsSize"}},{"kind":"Field","name":{"kind":"Name","value":"numErrors"}},{"kind":"Field","name":{"kind":"Name","value":"isSpinning"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}},{"kind":"Field","name":{"kind":"Name","value":"caches"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"temp"}},{"kind":"Field","name":{"kind":"Name","value":"fsFree"}},{"kind":"Field","name":{"kind":"Name","value":"fsUsed"}},{"kind":"Field","name":{"kind":"Name","value":"type"}}]}}]}}]}}]} as unknown as DocumentNode<ArrayStatusQuery, ArrayStatusQueryVariables>;
export const SystemInfoDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SystemInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"info"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"time"}},{"kind":"Field","name":{"kind":"Name","value":"os"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"platform"}},{"kind":"Field","name":{"kind":"Name","value":"distro"}},{"kind":"Field","name":{"kind":"Name","value":"release"}},{"kind":"Field","name":{"kind":"Name","value":"kernel"}},{"kind":"Field","name":{"kind":"Name","value":"uptime"}},{"kind":"Field","name":{"kind":"Name","value":"hostname"}}]}},{"kind":"Field","name":{"kind":"Name","value":"cpu"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"manufacturer"}},{"kind":"Field","name":{"kind":"Name","value":"brand"}},{"kind":"Field","name":{"kind":"Name","value":"cores"}},{"kind":"Field","name":{"kind":"Name","value":"threads"}}]}}]}}]}}]} as unknown as DocumentNode<SystemInfoQuery, SystemInfoQueryVariables>;