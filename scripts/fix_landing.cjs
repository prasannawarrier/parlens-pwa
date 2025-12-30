
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/pages/LandingPage.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Regex to match the entire canvas-based createPillIcon function
const regex = /const createPillIcon = \(color: string\) => \{[\s\S]*?return ctx\.getImageData\(0, 0, 48, 28\);\s*\};/;

const newCode = `const createPillIcon = (color: string) => {
    // 48x28 logical size. SVG handles scaling.
    const svg = \`
    <svg width="96" height="56" viewBox="0 0 96 56" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="2" width="92" height="52" rx="26" fill="\${color}" stroke="white" stroke-width="4"/>
    </svg>\`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
};`;

if (regex.test(content)) {
    console.log('Found match! Replacing...');
    const newContent = content.replace(regex, newCode);
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log('File updated successfully.');
} else {
    console.error('Could not find createPillIcon function to replace.');
    process.exit(1);
}
