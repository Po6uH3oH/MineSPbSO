export type Transfer = (label: string, bytes: number, total?: number) => void;
export const noProgress: Transfer = () => {};

