import Image, { type ImageProps } from "next/image";
import { cn } from "@/lib/utils";

type ExerciseIconImageProps = Omit<ImageProps, "className" | "alt"> & {
  className?: string;
  alt?: string;
};

/** Black silhouette PNGs; invert in dark mode for contrast on dark surfaces. */
export function ExerciseIconImage({
  className,
  alt = "",
  ...props
}: ExerciseIconImageProps) {
  return (
    <Image
      alt={alt}
      className={cn("object-contain dark:invert", className)}
      {...props}
    />
  );
}
