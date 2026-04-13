interface HTMLElement {
	textContent: string;
}

interface Document {
	getElementById(id: string): HTMLElement;
}

declare var myDoc: Document;
