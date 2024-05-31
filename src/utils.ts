export function toPrettyJSON(obj: any): string {
	return JSON.stringify(obj, null, 2);
}
