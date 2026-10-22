// Strong components preserve one-way drops: being near a platform does not mean
// a bot can climb back onto it. Used offline to cache directed reachability.
export function navigationComponents(edges) {
 const reverse=edges.map(()=>[]);edges.forEach((list,i)=>list.forEach(j=>reverse[j].push(i)));
 const seen=new Uint8Array(edges.length),order=[];
 for(let root=0;root<edges.length;root++) {
  if(seen[root])continue;seen[root]=1;const stack=[[root,0]];
  while(stack.length){const top=stack.at(-1),next=edges[top[0]][top[1]++];if(next===undefined){order.push(top[0]);stack.pop();}else if(!seen[next]){seen[next]=1;stack.push([next,0]);}}
 }
 const components=Array(edges.length).fill(-1);let count=0;
 for(let n=order.length-1;n>=0;n--){const root=order[n];if(components[root]>=0)continue;components[root]=count;const queue=[root];for(let i=0;i<queue.length;i++)for(const next of reverse[queue[i]])if(components[next]<0){components[next]=count;queue.push(next);}count++;}
 return components;
}
