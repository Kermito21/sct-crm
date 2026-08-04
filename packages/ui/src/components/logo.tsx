import type * as React from "react";

const Logo = ({
	className,
	...props
}: React.ImgHTMLAttributes<HTMLImageElement>) => (
	<img
		src="/sct-mark.png"
		alt="SCT"
		className={`invert dark:invert-0 ${className ?? ""}`}
		{...props}
	/>
);
export default Logo;
