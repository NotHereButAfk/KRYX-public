import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// All dimensions are metres. Barrel direction is -Z; grip markers are wrist
// contacts shared by first-person arms, remote avatars and the IK carry solve.
export const ARSENAL_MODEL_IDS = Object.freeze([
  'm4', 'magnum', 'battlerifle', 'energyshotgun', 'plasmarifle',
  'levershotgun', 'concussion', 'rpg', 'uzi', 'sword',
]);

class Armorer {
  constructor() {
    this.group = new THREE.Group();
    const material = (role, color, metalness, roughness, glow = 0) => {
      const m = new THREE.MeshStandardMaterial({ color, metalness, roughness,
        emissive: glow ? color : 0, emissiveIntensity: glow });
      m.userData.role = role;
      return m;
    };
    this.shell = material('body', 0x92999e, .48, .38);
    this.dark = material('metal', 0x262c31, .48, .48);
    this.orange = material('accent', 0xf08013, .3, .44);
    this.light = material('energy', 0xadf323, .15, .35, .65);
    this.rubber = material('wood', 0x171d23, .04, .85);
    this.trim = material('special', 0x52616b, .6, .4);
  }

  mesh(name, geometry, material, position = [0, 0, 0]) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  // A chamfered eight-sided section loft. Independent cross-sections give the
  // body a deliberately tapered silhouette, instead of a stack of box meshes.
  hull(name, stations, material = this.shell) {
    const positions = [], uv = [], indices = [];
    for (const [z, width, height, cy = 0, cx = 0] of stations) {
      const x = width / 2, y = height / 2, bevel = Math.min(x, y) * .38;
      const ring = [[-x+bevel,-y],[x-bevel,-y],[x,-y+bevel],[x,y-bevel],
        [x-bevel,y],[-x+bevel,y],[-x,y-bevel],[-x,-y+bevel]];
      ring.forEach(([rx, ry], i) => { positions.push(cx+rx,cy+ry,z); uv.push(i/7,(z+.85)/1.25); });
    }
    for (let j=0;j<stations.length-1;j++) for (let i=0;i<8;i++) {
      const a=j*8+i,b=j*8+(i+1)%8,c=b+8,d=a+8;
      indices.push(a,b,c,a,c,d);
    }
    for (let i=1;i<7;i++) { indices.push(0,i+1,i); const end=(stations.length-1)*8;indices.push(end,end+i,end+i+1); }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    geometry.setIndex(indices);
    const faceted = geometry.toNonIndexed(); geometry.dispose(); faceted.computeVertexNormals();
    return this.mesh(name,faceted,material);
  }

  block(name, size, position, material = this.dark, angle = 0) {
    const [w,h,l]=size, [x,y,z]=position;
    const mesh=this.hull(name,[[-l/2,w,h],[l/2,w,h]],material);
    mesh.position.set(x,y,z);mesh.rotation.x=angle;return mesh;
  }

  // Polygonal side plate in the Y/Z plane. Both faces use the same layout.
  plate(name, points, x, thickness, material = this.orange) {
    const shape=new THREE.Shape();
    points.forEach(([z,y],i)=>i?shape.lineTo(z,y):shape.moveTo(z,y));shape.closePath();
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false,steps:1});
    geometry.rotateY(-Math.PI/2);geometry.translate(thickness/2,0,0);
    return this.mesh(name,geometry,material,[x,0,0]);
  }

  sides(name, points, width, material = this.orange, thickness=.004) {
    for (const sign of [-1,1]) this.plate(name,points,sign*width/2,thickness,material);
  }

  barrel(name, radius, length, position, material = this.dark, inner = radius*.69) {
    // Open-ended tube, annular front lip, and a recessed black bore.
    const geometry=new THREE.CylinderGeometry(radius,radius,length,12,1,true);
    geometry.rotateX(Math.PI/2);
    this.mesh(name,geometry,material,position);
    const [x,y,z]=position;
    const lip=new THREE.RingGeometry(inner,radius,12);
    lip.rotateY(Math.PI);
    this.mesh(`${name} lip`,lip,material,[x,y,z-length/2]);
    const bore=new THREE.CircleGeometry(inner,12);bore.rotateY(Math.PI);
    this.mesh(`${name} bore`,bore,this.rubber,[x,y,z-length/2+.014]);
  }

  cylinder(name,radius,length,position,material=this.dark,sides=12) {
    const geometry=new THREE.CylinderGeometry(radius,radius,length,sides);
    geometry.rotateX(Math.PI/2);return this.mesh(name,geometry,material,position);
  }

  grip(z=.065) {
    this.sides('swept grip frame',[[z-.034,-.012],[z+.025,-.015],[z+.065,-.137],
      [z+.045,-.153],[z-.015,-.140]],0,this.dark,.050);
    this.sides('grip inserts',[[z-.020,-.045],[z+.020,-.037],[z+.046,-.126],
      [z+.031,-.136],[z-.009,-.126]],.052,this.rubber,.003);
    for(let i=0;i<4;i++)this.block('grip tread',[.055,.006,.038],[0,-.068-i*.015,z+.003+i*.006],this.trim,.25);
    this.block('trigger guard base',[.040,.011,.082],[0,-.042,z-.058]);
    this.block('trigger guard front',[.036,.040,.012],[0,-.024,z-.098],this.shell,-.12);
    this.block('trigger',[.008,.028,.010],[0,-.015,z-.035],this.dark,.24);
  }

  sights(front, rear, height=.143) {
    this.block('sight rail',[.036,.013,rear-front],[0,height-.017,(front+rear)/2]);
    for(const x of [-.018,.018])this.block('rear notch',[.009,.021,.018],[x,height+.004,rear]);
    this.block('front post',[.010,.028,.016],[0,height,front]);
    this.block('front sight dot',[.006,.005,.004],[0,height+.008,front+.010],this.light);
  }

  vents(start, count, spacing, x, y, material = this.dark) {
    for(const sign of [-1,1])for(let i=0;i<count;i++)
      this.block('recessed cooling slot',[.004,.011,.017],[sign*x,y,start+i*spacing],material,-.25);
  }

  stock(start, end, width=.068) {
    this.hull('stock spine',[[start,.045,.035,.05],[end-.02,.05,.038,.045]],this.dark);
    this.sides('skeleton stock',[[start,.059],[start+.055,.096],[end-.024,.096],
      [end,.064],[end,-.035],[end-.035,-.049],[end-.080,.023],[start,.025]],width,this.shell,.009);
    this.block('butt pad',[width+.005,.121,.022],[0,.025,end],this.rubber);
    this.block('stock orange heel',[width+.005,.018,.031],[0,.089,end-.015],this.orange);
  }

  display(z, count=5, y=.136) {
    this.block('angled charge monitor',[.052,.070,.068],[0,y,z],this.dark,-.48);
    for(let i=0;i<count;i++){
      const ly=-.023+i*.010,lz=.036;
      this.block('charge bar',[.033,.005,.002],[0,y+ly*Math.cos(.48)+lz*Math.sin(.48),z-ly*Math.sin(.48)+lz*Math.cos(.48)],this.light,-.48);
    }
  }

  magazine(z=-.11) {
    this.hull('curved magazine',[[z-.035,.052,.060,-.052],[z+.040,.052,.070,-.063]],this.dark);
    this.sides('curved magazine body',[[z-.035,-.054],[z+.035,-.055],[z+.042,-.110],
      [z+.014,-.195],[z-.041,-.186],[z-.016,-.108]],0,this.dark,.053);
    for(const x of [-.029,.029])for(let i=0;i<4;i++)
      this.plate('magazine flute',[[z-.017,-.077-i*.024],[z+.022,-.080-i*.024],
        [z+.018,-.086-i*.024],[z-.020,-.083-i*.024]],x,.003,this.trim);
  }

  finish(def, muzzle, pose) {
    // Merge fixed parts by material. A detailed rifle still costs only six
    // draw calls when eight remote players carry it. Named part markers stay
    // available to attachment/inspection tools without retaining draw calls.
    const batches=new Map(), markers=[];
    for(const part of this.group.children) {
      part.updateMatrix();
      const geometry=part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
      geometry.applyMatrix4(part.matrix);
      if(!batches.has(part.material)) batches.set(part.material,[]);
      batches.get(part.material).push(geometry);
      const marker=new THREE.Object3D();marker.name=part.name;
      marker.position.copy(part.position);marker.quaternion.copy(part.quaternion);markers.push(marker);
      part.geometry.dispose();
    }
    this.group.clear();
    for(const [material,geometries] of batches) {
      const merged=mergeGeometries(geometries,false);
      geometries.forEach(geometry=>geometry.dispose());
      merged.userData.shared=true;
      this.mesh(`arsenal ${material.userData.role}`,merged,material);
    }
    this.group.add(...markers);
    const marker=new THREE.Object3D();marker.name='muzzle';marker.position.set(...muzzle);this.group.add(marker);
    this.group.userData={weaponId:def.id,weaponKind:def.kind,modelSource:'reference',
      designRevision:2,authoredHandPose:{support:[0,-.08,-.1],reload:[-.04,-.16,.1],...pose}};
    return {group:this.group,muzzle:marker};
  }
}

const riflePose=(support=-.27,carry='rifle')=>({trigger:[.012,-.043,.060],
  support:[-.032,.000,support],reload:[-.040,-.20,-.11],carry,supportVisible:true});

function autoRifle(a) {
  // September 24 video, 40.6 s: enclosed orange fore-end, stepped gray
  // receiver and a sloping six-bar display flowing into the rear channel.
  // Author the extended silhouette directly so sights and muzzle cannot
  // separate from their housing when the player views it from the side.
  a.shell.color.setHex(0x989b9f); a.shell.metalness=.24; a.shell.roughness=.66;
  a.dark.color.setHex(0x34353b); a.dark.metalness=.2;
  a.trim.color.setHex(0x70747b); a.trim.metalness=.24;
  a.orange.color.setHex(0xef7912); a.orange.metalness=.16;
  a.light.emissiveIntensity=.28;
  a.hull('auto rifle receiver',[[-.323,.082,.080,.064],[-.270,.118,.129,.060],
    [-.110,.124,.139,.057],[.115,.120,.126,.055],[.192,.102,.106,.055],
    [.216,.075,.072,.055]]);
  a.hull('enclosed long fore-end',[[-.782,.066,.078,.067],[-.756,.083,.093,.066],
    [-.364,.084,.093,.066],[-.304,.102,.095,.059],[-.259,.104,.094,.056]]);
  a.sides('continuous orange fore-end insert',[[-.771,.087],[-.330,.087],[-.304,.073],
    [-.278,.073],[-.270,.032],[-.316,.026],[-.761,.033],[-.780,.046]],.088,a.orange,.006);
  a.hull('gray shroud cap',[[-.781,.073,.017,.113],[-.741,.086,.019,.117],
    [-.344,.087,.019,.117],[-.306,.100,.023,.107]],a.shell);
  a.hull('dark lower shroud seam',[[-.767,.073,.017,.015],[-.344,.082,.019,.015],
    [-.294,.089,.023,.012]],a.dark);
  a.hull('front muzzle armor',[[-.788,.066,.078,.067],[-.768,.076,.086,.067]],a.trim);
  a.barrel('flush rifle bore',.018,.012,[0,.067,-.788],a.dark,.012);
  a.block('front blade sight',[.009,.046,.021],[0,.142,-.754],a.shell,-.12);
  // Low sculpted shoulders step up around the forward receiver, rather than
  // repeated tactical rails and an exposed gas tube along the barrel.
  a.hull('forward sight shoulder',[[-.732,.063,.018,.128],[-.709,.073,.022,.130],
    [-.682,.065,.012,.124]],a.shell);
  a.sides('stepped receiver armor',[[-.336,.086],[-.296,.135],[-.256,.145],[-.228,.127],
    [-.153,.126],[-.123,.104],[.130,.104],[.185,.117],[.209,.095],
    [.209,.023],[.128,.002],[-.120,-.009],[-.254,.013],[-.308,.040]],.124,a.shell,.008);
  a.sides('forward shoulder inset',[[-.296,.122],[-.263,.131],[-.219,.119],
    [-.166,.119],[-.180,.089],[-.266,.089]],.135,a.trim,.004);
  a.sides('receiver shoulder face',[[-.287,.126],[-.264,.133],[-.219,.123],
    [-.169,.123],[-.182,.100],[-.264,.099]],.140,a.shell,.003);
  a.hull('upper forward spine',[[-.287,.047,.022,.144],[-.252,.052,.028,.147],
    [-.203,.047,.021,.142],[-.114,.046,.019,.137]],a.shell);
  a.sides('vertical receiver recess',[[-.121,.110],[-.092,.105],[-.094,.047],
    [-.124,.053]],.137,a.dark,.003);
  a.sides('forward indicator pocket',[[-.276,.068],[-.196,.068],[-.187,.050],
    [-.272,.047]],.135,a.trim,.002);
  a.sides('forward lime dash',[[-.268,.062],[-.204,.062],[-.200,.055],[-.267,.055]],.140,a.light,.002);
  a.sides('single lime status mark',[[-.163,.053],[-.154,.057],[-.153,.030],[-.161,.030]],.136,a.light,.002);
  a.sides('side charge grille recess',[[-.091,.041],[-.003,.041],[-.003,.002],[-.091,.002]],.134,a.trim,.002);
  for(const side of [-1,1])for(let i=0;i<6;i++) {
    const z=-.083+i*.014;
    a.plate('six-bar side charge grille',[[z,.037],[z+.006,.037],[z+.007,.007],[z+.001,.007]],side*.070,.002,a.light);
  }
  // Display and rear trough form one continuous stepped top profile. The
  // screen leans at 45 degrees into a solid ramp; its rear channel joins
  // the receiver instead of leaving an upright scope on a stalk.
  a.hull('integrated monitor ramp',[[-.132,.066,.042,.143],[-.073,.067,.079,.151],
    [.004,.064,.011,.122]],a.dark);
  a.block('sloping monitor bezel',[.063,.093,.011],[0,.153,-.035],a.dark,-Math.PI/4);
  a.block('gray monitor face',[.052,.081,.003],[0,.157,-.031],a.shell,-Math.PI/4);
  for(let i=0;i<6;i++) {
    const ly=-.031+i*.012, lz=.004;
    a.block('six-bar rifle display',[.026,.007,.002],
      [0,.157+(ly+lz)*Math.SQRT1_2,-.031+(-ly+lz)*Math.SQRT1_2],a.light,-Math.PI/4);
  }
  a.sides('monitor buttress',[[-.111,.162],[-.079,.174],[-.001,.104],
    [.016,.104],[.016,.091],[-.061,.115]],.068,a.shell,.005);
  a.block('rear top channel bed',[.059,.008,.157],[0,.115,.092],a.dark);
  a.block('recessed rear channel panel',[.044,.007,.133],[0,.120,.090],a.shell);
  for(const side of [-1,1]) a.block('rear channel border',[.0035,.007,.171],[side*.0325,.122,.094],a.dark);
  a.block('channel rear stop',[.065,.006,.006],[0,.123,.179],a.dark);
  a.hull('receiver rear collar',[[.177,.104,.105,.055],[.198,.112,.117,.058],
    [.218,.085,.087,.053]],a.shell);
  a.sides('beveled lower receiver ledge',[[-.287,.030],[-.245,.014],[-.110,.012],
    [-.082,-.003],[.128,.001],[.172,.018],[.205,.013],[.192,-.017],
    [.101,-.029],[-.107,-.025],[-.252,-.008],[-.288,.010]],.125,a.trim,.006);
  a.sides('rear receiver inset border',[[.017,.091],[.127,.091],[.158,.078],
    [.149,.036],[.014,.036]],.134,a.trim,.002);
  a.sides('rear receiver inset face',[[.023,.087],[.124,.087],[.153,.076],
    [.146,.041],[.020,.041]],.137,a.shell,.002);
  a.hull('lower receiver',[[-.253,.085,.040,.000],[-.109,.092,.045,-.003],
    [.085,.080,.039,.003],[.170,.074,.035,.012]],a.trim);
  a.hull('flared magazine well',[[-.151,.066,.040,-.020],[-.046,.065,.040,-.020]],a.shell);
  a.block('magazine well lip',[.072,.009,.109],[0,-.040,-.098],a.dark);
  a.grip(); a.magazine(-.095);
  a.block('support hand cradle',[.067,.032,.135],[0,.004,-.283],a.dark);
  // Restrained functional details remain visible in the close firing hold.
  for(const side of [-1,1]) {
    a.block('magazine release',[.008,.011,.019],[side*.046,.009,-.049],a.dark);
    a.block('receiver catch',[.008,.016,.020],[side*.068,.021,.083],a.dark);
    a.block('fire selector',[.009,.006,.020],[side*.045,.006,.025],a.trim,-.4);
    const pin=a.mesh('receiver pin',new THREE.CylinderGeometry(.004,.004,.003,8),a.trim,[side*.065,.059,.156]);
    pin.rotation.z=Math.PI/2;
  }
  a.plate('recessed ejection port',[[-.045,.094],[.049,.094],[.053,.064],[-.045,.064]],.070,.002,a.dark);
  a.block('bolt visible in port',[.003,.012,.062],[.072,.079,.005],a.trim);
  a.cylinder('stock buffer tube',.026,.094,[0,.052,.259],a.dark);
  a.hull('orange stock heel',[[.292,.041,.070,.035],[.312,.075,.103,.025],
    [.343,.073,.115,.020]],a.orange);
  a.block('stock recoil pad',[.077,.120,.022],[0,.020,.348],a.rubber);
  return [[0,.067,-.794],riflePose(-.29)];
}

function handCannon(a) {
  // September 26 video: slab-sided gray shroud, long orange inlay, lime
  // shoulder vents and a round armored cylinder inside a sculpted frame.
  a.shell.color.setHex(0x97999e); a.shell.metalness=.24; a.shell.roughness=.64;
  a.dark.color.setHex(0x303136); a.trim.color.setHex(0x666a71);
  a.orange.color.setHex(0xf08013); a.light.emissiveIntensity=.30;
  a.hull('hand cannon barrel',[[-.300,.074,.085,.075],[-.280,.091,.100,.075],
    [-.074,.094,.100,.075],[-.023,.103,.110,.063]],a.shell);
  a.sides('orange barrel inlay',[[-.279,.090],[-.079,.090],[-.062,.073],
    [-.082,.054],[-.274,.054]],.096,a.orange,.003);
  a.sides('barrel inlay machined line',[[-.261,.067],[-.113,.067],[-.121,.063],[-.259,.063]],.100,a.trim,.001);
  a.hull('underlug',[[-.288,.058,.025,.016],[-.055,.066,.039,.002],[-.023,.067,.028,.008]],a.dark);
  a.barrel('recessed crown',.026,.024,[0,.075,-.303],a.trim,.016);
  // The rear drum remains exposed through the top/rear of the yoke. Broad
  // side shoulders wrap it without letting the glove cover the mechanism.
  a.cylinder('revolver cylinder',.051,.103,[0,.051,.032],a.trim,16);
  for(let i=0;i<8;i++) {
    const angle=i*Math.PI/4, x=Math.cos(angle)*.049,y=.051+Math.sin(angle)*.049;
    const flute=a.block('cylinder flute',[.017,.004,.074],[x,y,.032],a.dark);
    flute.rotation.z=angle-Math.PI/2;
    a.cylinder('chamber rim',.007,.003,[Math.cos(angle)*.032,.051+Math.sin(angle)*.032,.085],a.dark,10);
  }
  a.sides('sculpted cylinder yoke',[[-.060,.106],[-.020,.125],[.029,.117],[.079,.077],
    [.104,.017],[.136,-.004],[.147,-.033],[.097,-.041],[.046,-.013],[-.012,.003],[-.053,.039]],.092,a.shell,.011);
  for(const side of [-1,1]) {
    const ring=new THREE.RingGeometry(.043,.046,24);
    ring.rotateY(side*Math.PI/2);
    a.mesh('lime cylinder seam',ring,a.light,[side*.053,.051,.015]);
    a.plate('cylinder side armor',[[-.033,.078],[-.007,.091],[.032,.080],[.051,.052],
      [.028,.017],[-.014,.018],[-.035,.043]],side*.054,.004,a.shell);
    a.plate('vent shoulder',[[-.084,.112],[-.042,.130],[-.008,.107],[-.052,.083]],side*.052,.005,a.trim);
    for(let i=0;i<5;i++) {
      const z=-.075+i*.009;
      a.plate('lime shoulder vent',[[z,.111],[z+.004,.113],[z+.013,.091],[z+.009,.089]],side*.056,.002,a.light);
    }
    a.plate('yoke panel seam',[[.043,.004],[.086,-.019],[.087,-.023],[.041,.000]],side*.053,.002,a.trim);
    const screw=a.mesh('frame screw',new THREE.CylinderGeometry(.004,.004,.004,8),a.dark,[side*.054,.005,.091]);
    screw.rotation.z=Math.PI/2;
  }
  a.hull('breech frame',[[.078,.054,.084,.034],[.112,.073,.096,.011],[.145,.060,.066,-.009]]);
  a.block('top strap',[.034,.015,.140],[0,.117,.039],a.shell);
  a.block('hammer spur',[.019,.020,.024],[0,.100,.127],a.dark,-.28);
  a.sides('swept grip frame',[[.095,-.015],[.138,-.030],[.179,-.149],[.161,-.171],
    [.092,-.150],[.075,-.065]],0,a.dark,.057);
  a.sides('orange grip panels',[[.104,-.043],[.132,-.048],[.162,-.140],[.147,-.152],
    [.099,-.134],[.088,-.073]],.060,a.orange,.004);
  for(const side of [-1,1]) {
    const pin=a.mesh('grip panel screw',new THREE.CylinderGeometry(.005,.005,.004,8),a.trim,[side*.034,-.077,.113]);
    pin.rotation.z=Math.PI/2;
    a.block('cylinder latch',[.007,.009,.020],[side*.040,.057,.105],a.trim);
  }
  a.block('trigger guard bow',[.037,.010,.083],[0,-.044,.040],a.trim);
  a.block('trigger guard front',[.035,.041,.010],[0,-.022,.004],a.trim,-.12);
  a.block('curved trigger',[.009,.026,.009],[0,-.015,.050],a.dark,.30);
  // Low integrated sights leave the broad gray top visible, as in the video.
  a.block('front blade sight',[.010,.013,.018],[0,.132,-.269],a.trim);
  for(const side of [-1,1])a.block('rear notch',[.008,.011,.016],[side*.014,.132,-.017],a.trim);
  return [[0,.075,-.315],{trigger:[.010,-.071,.114],support:[-.028,-.072,.125],reload:[-.03,-.17,.10],carry:'pistol',supportVisible:false}];
}

function burstRifle(a) {
  a.hull('burst rifle monocoque',[[-.335,.074,.083,.065],[-.284,.119,.133,.066],[-.10,.124,.127,.071],
    [.087,.088,.105,.061],[.157,.061,.060,.063]]);
  a.sides('orange faceted cowl',[[-.286,.096],[-.253,.133],[-.120,.131],[-.077,.092],[-.115,.060],[-.243,.053],[-.278,.065]],.126);
  a.hull('lower handguard',[[-.32,.062,.050,.017],[-.25,.090,.045,.015],[-.10,.085,.039,.010]],a.dark);
  a.vents(-.258,4,.033,.048,.013,a.trim);
  a.barrel('exposed burst barrel',.018,.163,[0,.073,-.409]);
  a.barrel('ported burst brake',.026,.056,[0,.073,-.515],a.shell);
  a.sides('brake exhaust slots',[[-.536,.082],[-.519,.088],[-.511,.078],[-.525,.072]],.053,a.dark);
  a.grip();a.magazine(-.102);a.stock(.14,.337);
  a.sights(-.509,-.20,.151);a.display(.029,4,.127);
  return [[0,.073,-.545],riflePose(-.266)];
}

function sweeper(a) {
  a.hull('sweeper broad forward casing',[[-.417,.087,.077,.061],[-.385,.125,.105,.066],[-.16,.128,.112,.064],[-.104,.094,.078,.063]]);
  a.hull('sweeper bullpup receiver',[[-.134,.09,.104,.064],[.055,.116,.124,.062],[.24,.120,.117,.061],[.32,.095,.098,.056]]);
  a.sides('orange breach shoulder',[[-.17,.094],[-.112,.113],[-.054,.100],[-.079,.057],[-.153,.059]],.132);
  a.sides('graphite angled brace',[[-.120,.104],[-.105,.106],[-.060,-.038],[-.078,-.047]],.129,a.dark,.008);
  a.sides('rear gray inset',[[.033,.100],[.246,.100],[.291,.055],[.242,.025],[.030,.047]],.124,a.trim);
  a.vents(.078,5,.032,.067,.052,a.light);
  a.block('sweeper top rail',[.04,.021,.44],[0,.139,-.03]);
  for(const x of [-.022,.022])a.barrel('sweeper twin aperture',.022,.025,[x,.061,-.416],a.dark,.015);
  a.grip(.053);a.block('rear magazine',[.073,.078,.075],[0,-.034,.222]);
  a.block('sweeper fore-end grip',[.068,.033,.160],[0,.002,-.283]);
  a.sights(-.367,-.104,.152);
  return [[0,.061,-.430],riflePose(-.281,'shotgun')];
}

function laserRifle(a) {
  a.hull('laser long emitter',[[-.537,.060,.066,.069],[-.501,.087,.094,.069],[-.21,.094,.092,.069],[-.157,.073,.063,.065]]);
  a.hull('laser receiver',[[-.187,.087,.101,.058],[.079,.111,.110,.052],[.142,.087,.088,.053]]);
  a.hull('rear power housing',[[.112,.081,.087,.041],[.19,.112,.113,.039],[.327,.118,.119,.035],[.374,.087,.089,.027]],a.orange);
  a.sides('laser gray rear armor',[[.137,.084],[.291,.095],[.359,.068],[.341,.044],[.247,.044],[.205,.017],[.137,.031]],.120,a.shell,.009);
  a.sides('orange emitter rails',[[-.515,.045],[-.447,.055],[-.116,.048],[-.077,.026],[-.237,.014],[-.484,.022]],.106,a.orange,.017);
  a.vents(-.472,6,.030,.049,.085,a.light);
  a.vents(-.119,3,.036,.058,.035,a.light);
  a.block('lower emitter shoe',[.063,.038,.187],[0,.001,-.277]);
  a.block('laser aperture',[.065,.050,.012],[0,.070,-.536]);
  a.block('inner emitter',[.044,.012,.003],[0,.070,-.543],a.light);
  a.grip();a.display(.016,6,.134);
  a.block('replaceable cell',[.062,.083,.093],[0,-.062,-.108]);
  a.block('rear black spine',[.043,.023,.254],[0,.103,.248]);
  return [[0,.070,-.547],riflePose(-.28)];
}

function miniSmg(a) {
  a.hull('mini smg folded receiver',[[-.291,.054,.070,.060],[-.262,.081,.087,.062],[-.095,.086,.097,.056],[.119,.066,.082,.047]]);
  a.sides('smg orange cowl',[[-.251,.071],[-.213,.087],[-.080,.087],[-.058,.063],[-.087,.048],[-.251,.047]],.088);
  a.sides('smg receiver side panel',[[-.067,.077],[.085,.077],[.105,.052],[.071,.026],[-.056,.027]],.088,a.trim);
  a.barrel('smg muzzle',.023,.05,[0,.060,-.309],a.dark);
  a.grip();a.block('short foregrip',[.059,.038,.111],[0,.005,-.195]);
  a.sides('smg stick magazine',[[-.115,-.01],[-.058,-.015],[-.050,-.158],[-.098,-.168]],0,a.dark,.040);
  a.block('magazine base',[.054,.014,.059],[0,-.158,-.075],a.orange,-.07);
  for(const x of [-.026,.026])for(let i=0;i<3;i++)a.block('magazine witness port',[.004,.01,.014],[x,-.057-i*.029,-.082],a.trim);
  for(const x of [-.028,.028])a.block('telescoping stock tube',[.013,.015,.154],[x,.051,.184],a.dark);
  a.block('smg buttpad',[.064,.073,.02],[0,.029,.267],a.rubber);
  a.sights(-.26,.037,.112);a.vents(-.187,3,.031,.048,.062,a.light);
  return [[0,.060,-.336],riflePose(-.194,'compact')];
}

function shotgun(a) {
  a.hull('shotgun angular action',[[-.20,.071,.094,.051],[-.117,.099,.111,.051],[.105,.090,.104,.048],[.144,.056,.060,.048]]);
  a.sides('orange action insert',[[-.138,.080],[.066,.081],[.099,.059],[.056,.037],[-.104,.028],[-.143,.045]],.102);
  a.barrel('shotgun barrel',.026,.315,[0,.070,-.334],a.dark);
  a.barrel('shotgun muzzle',.032,.037,[0,.070,-.504],a.trim);
  a.cylinder('magazine tube',.019,.264,[0,.013,-.307],a.trim);
  a.hull('pump slide',[[-.365,.066,.052,.009],[-.341,.083,.065,.012],[-.221,.083,.065,.012],[-.203,.060,.050,.014]],a.dark);
  for(let i=0;i<6;i++)a.block('pump chevron rib',[.088,.065,.011],[0,.012,-.335+i*.022],a.orange);
  a.hull('barrel heat shield',[[-.469,.041,.020,.101],[-.249,.052,.026,.103]],a.shell);
  a.vents(-.445,6,.031,.027,.103);
  a.grip();a.stock(.132,.351);a.sights(-.460,-.036,.123);
  for(let i=0;i<3;i++)a.cylinder('side saddle shell',.009,.056,[-.055,.059,-.116+i*.04],a.trim);
  return [[0,.070,-.525],riflePose(-.29,'shotgun')];
}

function grenadeLauncher(a) {
  a.hull('grenade action',[[-.184,.066,.077,.077],[.09,.086,.088,.073],[.139,.058,.052,.065]]);
  a.cylinder('rotating drum',.074,.142,[0,.010,-.105],a.dark,12);
  for(let i=0;i<6;i++) {
    const t=i*Math.PI/3,x=Math.cos(t)*.059,y=.010+Math.sin(t)*.059;
    a.cylinder('chamber sleeve',.024,.136,[x,y,-.105],a.trim,8);
    a.cylinder('orange chamber cap',.019,.012,[x,y,-.178],a.orange,8);
  }
  a.barrel('grenade launch tube',.049,.208,[0,.068,-.300],a.shell,.036);
  a.barrel('grenade muzzle rim',.055,.03,[0,.068,-.4],a.dark,.038);
  a.sides('orange barrel armor',[[-.37,.090],[-.20,.095],[-.19,.063],[-.26,.040],[-.37,.049]],.107,a.orange);
  a.block('foregrip',[.064,.042,.095],[0,.000,-.284]);
  a.grip();a.stock(.14,.297,.065);
  for(const x of [-.021,.021])a.block('folding ladder upright',[.006,.049,.012],[x,.138,-.10]);
  for(let i=0;i<3;i++)a.block('range ladder rung',[.042,.005,.011],[0,.121+i*.016,-.10],a.orange);
  return [[0,.068,-.417],riflePose(-.281,'launcher')];
}

function rocketLauncher(a) {
  a.hull('octagonal launcher body',[[-.407,.139,.136,.104],[-.375,.17,.162,.104],[-.258,.16,.147,.101],
    [.16,.150,.146,.096],[.25,.171,.161,.097],[.294,.166,.154,.097]]);
  a.barrel('front exhaust lip',.089,.036,[0,.104,-.409],a.dark,.064);
  a.barrel('rear exhaust collar',.083,.035,[0,.097,.299],a.dark,.064);
  a.sides('orange launcher panel',[[-.355,.15],[-.302,.164],[-.144,.155],[-.127,.132],[-.303,.120],[-.355,.125]],.173,a.orange,.010);
  a.sides('rear armor blade',[[.047,.149],[.218,.162],[.263,.141],[.247,.071],[.095,.07],[.047,.098]],.173,a.trim,.009);
  a.block('shoulder cradle',[.095,.034,.158],[0,.006,.179],a.rubber);
  a.grip(.075);a.block('vertical forward grip',[.052,.080,.065],[0,-.016,-.268],a.rubber,.09);
  a.vents(-.191,5,.031,.086,.102,a.light);
  a.block('sight cantilever',[.034,.015,.084],[.097,.134,-.046]);
  a.cylinder('offset optic',.018,.091,[.108,.164,-.044],a.dark);
  a.cylinder('rear optic lens',.014,.003,[.108,.164,.004],a.light);
  return [[0,.104,-.429],riflePose(-.264,'launcher')];
}

function sword(a) {
  // Side plates are authored in X/Z, then laid onto the flat Y faces.
  const blade=(name,points,depth,mat,y=-.02)=>{
    const shape=new THREE.Shape();points.forEach(([x,z],i)=>i?shape.lineTo(x,z):shape.moveTo(x,z));shape.closePath();
    const geometry=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,steps:1});
    geometry.rotateX(Math.PI/2);geometry.translate(0,depth/2,0);
    return a.mesh(name,geometry,mat,[0,y,0]);
  };
  blade('sword hardened spine',[[.030,.05],[-.022,.042],[-.044,-.14],[-.045,-.65],[-.020,-.810],[.023,-.748],
    [.031,-.62],[.023,-.60],[.031,-.56],[.031,-.32],[.022,-.30],[.032,-.26],[.033,-.10]],.018,a.dark);
  blade('lime honed cutting edge',[[-.022,.042],[-.040,.018],[-.050,-.008],[-.044,-.035],[-.052,-.18],
    [-.051,-.646],[-.020,-.810],[-.035,-.64],[-.036,-.16]],.019,a.light);
  for(const y of [-.032,-.008]) {
    blade('blade inset armor',[[-.024,-.08],[.008,-.061],[.018,-.089],[.018,-.236],[.008,-.252],[.008,-.371],
      [.019,-.39],[.018,-.557],[.004,-.578],[.003,-.691],[-.025,-.71]],.005,a.shell,y);
    blade('orange blade channel',[[-.026,-.49],[-.017,-.477],[-.017,-.694],[.012,-.748],[-.020,-.786]],.006,a.orange,y);
    for(const z of [-.199,-.216]){const band=a.block('blade warning stripe',[.038,.005,.007],[-.006,y,z],a.orange);band.rotation.y=.22;}
    for(const z of [-.094,-.110,-.126]) {const pin=new THREE.CylinderGeometry(.0025,.0025,.007,8);a.mesh('blade fastener',pin,a.dark,[.005,y,z]);}
  }
  a.hull('chamfered guard',[[.037,.154,.032,-.020],[.056,.184,.034,-.020],[.081,.157,.030,-.020]],a.trim);
  a.block('orange guard inset',[.074,.008,.019],[0,-.040,.058],a.orange);
  a.hull('sword grip',[[.077,.032,.032,-.020],[.158,.036,.034,-.020],[.265,.030,.031,-.020]],a.rubber);
  for(let i=0;i<8;i++)a.block('wrapped handle band',[.042,.043,.010],[0,-.020,.092+i*.022],a.dark);
  a.hull('faceted pommel',[[.261,.036,.036,-.020],[.278,.05,.046,-.020],[.293,.038,.038,-.020]],a.trim);
  return [[0,-.02,-.810],{trigger:[0,-.02,.160],supportVisible:false,carry:'melee'}];
}

const BUILDERS={m4:autoRifle,magnum:handCannon,battlerifle:burstRifle,energyshotgun:sweeper,
  plasmarifle:laserRifle,uzi:miniSmg,levershotgun:shotgun,concussion:grenadeLauncher,rpg:rocketLauncher,sword};
const templates=new Map();

export function buildArsenalWeapon(def) {
  const build=BUILDERS[def?.id];
  if (!build) return null;
  if(!templates.has(def.id)) {
    const armorer=new Armorer();
    const [muzzle,pose]=build(armorer);
    templates.set(def.id,armorer.finish(def,muzzle,pose).group);
  }
  const group=templates.get(def.id).clone(true);
  group.traverse(object=>{if(object.isMesh)object.material=object.material.clone();});
  return {group,muzzle:group.getObjectByName('muzzle')};
}
