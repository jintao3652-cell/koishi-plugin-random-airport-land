interface TextImageSection {
    title: string;
    content: string;
}
declare function textToImage(input: string | TextImageSection[]): Promise<any>;
export { textToImage };
