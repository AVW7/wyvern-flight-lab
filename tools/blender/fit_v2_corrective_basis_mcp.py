import json
import numpy as np
from pathlib import Path

OUT=Path(globals().get('bake_directory','/Users/ajadvanwyk/Documents/biome/fantasy-biomes-next/assets/harvest-candidates/2026-10-07/runtime-corrective'))
progress=json.loads((OUT/'bake-progress.json').read_text())
frames=progress.get('frames',145);fps=progress.get('fps',24)
assert sorted(progress['completed_frames'])==list(range(frames))
calibration=json.loads((OUT/'bind-calibration.json').read_text())
source=json.loads((OUT/'source-attributes.json').read_text())
count=len(source['positions'])
transform=np.asarray(calibration['mesh_to_blender_affine'])[:3]
shape=(frames,count,3)
position=np.asarray(np.memmap(OUT/'position-deltas.bin',dtype='<f4',mode='r',shape=shape),dtype=np.float64)@transform
preserve_normals=globals().get('preserve_authored_normals',False)
normal=None if preserve_normals else np.asarray(np.memmap(OUT/'normal-deltas.bin',dtype='<f4',mode='r',shape=shape),dtype=np.float64)
position[-1]=position[0]
if normal is not None: normal[-1]=normal[0]

# Half a pixel in the inspected 900px, 4200-unit orthographic close view.
position_bound=0.5*4200/900
# Original signed normalized INT8 normals have a 1/127 component quantum.
normal_bound=1/127

def fit(field,bound):
    data=field.reshape(frames,-1)
    gram=data@data.T
    values,vectors=np.linalg.eigh(gram)
    order=np.argsort(values)[::-1]
    values=values[order];vectors=vectors[:,order]
    positive=values>np.finfo(np.float64).eps*values[0]
    values=values[positive];vectors=vectors[:,positive]
    coefficients=vectors*np.sqrt(values)[None,:]
    basis=(vectors.T@data)/np.sqrt(values)[:,None]
    reconstruction=np.zeros_like(data)
    errors=[]
    rank=None
    for i in range(len(values)):
        reconstruction+=coefficients[:,i,None]*basis[i,None,:]
        error=float(np.linalg.norm((reconstruction-data).reshape(shape),axis=2).max())
        errors.append({'rank':i+1,'max_error':error})
        if error<=bound:
            rank=i+1
            break
    assert rank is not None, 'No finite low-rank basis meets measured fidelity'
    coefficients=coefficients[:,:rank];basis=basis[:rank].reshape(rank,count,3)
    scales=np.max(np.abs(coefficients),axis=0)
    coefficients/=scales[None,:];basis*=scales[:,None,None]
    coefficients[-1]=coefficients[0]
    return basis,coefficients,errors

preserve_normals=globals().get("preserve_authored_normals",False)
position_fit_bound=position_bound/2 if preserve_normals else position_bound
p_basis,p_coeff,p_errors=fit(position,position_fit_bound)
if preserve_normals:
    n_basis=np.empty((0,count,3));n_coeff=np.empty((frames,0));n_errors=[]
else:
    n_basis,n_coeff,n_errors=fit(normal,normal_bound)
p_basis=p_basis@np.linalg.inv(transform)
np.asarray(p_basis,dtype='<f4').tofile(OUT/'position-basis.bin')
np.asarray(n_basis,dtype='<f4').tofile(OUT/'normal-basis.bin')
coefficients=np.concatenate([p_coeff,n_coeff],axis=1)
np.asarray(coefficients,dtype='<f4').tofile(OUT/'morph-coefficients.bin')
report={'source_sha256':source['source_sha256'],'vertices':count,'frames':frames,'fps':fps,'position_targets':len(p_basis),'normal_targets':len(n_basis),'total_targets':coefficients.shape[1],
        'normal_policy':'preserve source authored normals' if preserve_normals else 'bake evaluated normals','position_fit_bound':position_fit_bound,'position_fit_bound_reference':'half the runtime error allowance reserved for basis fitting, remainder for interpolation' if preserve_normals else 'runtime bound','position_error_bound_rig_units':position_bound,'position_bound_reference':'22-blender-mcp-corrective-cruise-rig.md macro frame36: ortho scale4200, width900; half a raster pixel',
        'normal_error_bound':normal_bound,'normal_bound_reference':'source NORMAL accessor signed normalized INT8: component quantum1/127',
        'position_rank_measurements':p_errors,'normal_rank_measurements':n_errors,
        'coefficient_range':[float(coefficients.min()),float(coefficients.max())],'loop_policy':'last coefficient row equals first exactly; other clips receive zero reset tracks'}
(OUT/'basis-report.json').write_text(json.dumps(report,indent=2))
result={k:v for k,v in report.items() if not k.endswith('measurements')}
