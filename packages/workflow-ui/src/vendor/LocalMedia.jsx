import React from "react";
export function LocalImage({fill,unoptimized,...props}){return <img {...props} style={fill?{width:"100%",height:"100%",objectFit:"cover"}:props.style}/>;}
