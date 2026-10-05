'use strict';
function clampBounds(bounds,area){return {...bounds,x:Math.max(area.x,Math.min(bounds.x,area.x+area.width-bounds.width)),y:Math.max(area.y,Math.min(bounds.y,area.y+area.height-bounds.height))};}
function dockBounds(area){const width=Math.min(580,area.width);return {x:area.x+Math.round((area.width-width)/2),y:area.y+4,width,height:106};}
function bubbleBounds(x,y,area){return clampBounds({x:Math.round(x-32),y:Math.round(y-32),width:64,height:64},area);}
function expandBounds(bounds,expanded,area){const width=expanded?420:64,height=expanded?345:64;return clampBounds({x:bounds.x+bounds.width-width,y:bounds.y+bounds.height-height,width,height},area);}
module.exports={clampBounds,dockBounds,bubbleBounds,expandBounds};
