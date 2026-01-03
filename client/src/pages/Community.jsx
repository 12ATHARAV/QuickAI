import { useUser } from '@clerk/clerk-react';
import React, { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import axios from 'axios'
import toast from 'react-hot-toast';
import { useAuth } from '@clerk/clerk-react';

axios.defaults.baseURL = import.meta.env.VITE_BASE_URL;


const Community = () => {
  const [creations, setCreations] = useState([]);
  const { user } = useUser();
  const [loading, setLoading] = useState(false)
    
  const {getToken} = useAuth()

  const fetchCreations = async () => {
    try {
      setLoading(true)
      const {data} = await axios.get('/api/user/get-published-creations', {
          headers: {Authorization: `Bearer ${await getToken()}`}
      })

      if(data.success){
        // Filter to show only image type creations
        const imageCreations = data.creations.filter(creation => creation.type === 'image')
        setCreations(imageCreations)
      }else{
        toast.error(data.message)
      }
    } catch (error) {
      toast.error(error.message)
    }
    setLoading(false)
  }

  const imageLikeToggle = async(id)=>{
    try {
      // Optimistically update the UI
      setCreations(prevCreations => 
        prevCreations.map(creation => {
          if (creation.id === id) {
            const currentLikes = creation.likes || [];
            const userIdStr = user?.id?.toString();
            const isLiked = currentLikes.includes(userIdStr);
            
            return {
              ...creation,
              likes: isLiked 
                ? currentLikes.filter(userId => userId !== userIdStr)
                : [...currentLikes, userIdStr]
            };
          }
          return creation;
        })
      );

      const {data} = await axios.post('/api/user/toggle-like-creation', {
        id
      }, {
        headers: {Authorization: `Bearer ${await getToken()}`}
      })

      if(data.success){
        toast.success(data.message)
        // No need to refetch - UI is already updated optimistically
      }else{
        // Revert optimistic update on error
        await fetchCreations()
        toast.error(data.message)
      }
    } catch (error) {
      // Revert optimistic update on error
      await fetchCreations()
      toast.error(error.message)
    }
  }

  
  useEffect(() => {
    if (user) {
      fetchCreations();
    }
  }, [user]);

  return !loading ? (
    <div className="flex-1 h-full flex flex-col gap-4 p-6">
      Creations
      <div className="bg-white h-full w-full rounded-xl overflow-y-scroll flex flex-wrap">
        {creations.length === 0 ? (
          <div className="w-full flex justify-center items-center h-full">
            <p className="text-gray-500">No images found</p>
          </div>
        ) : (
          creations.map((creation, index) => (
            <div
              key={creation.id || index}
              className="relative group inline-block pl-3 pt-3 w-full sm:max-w-1/2 lg:max-w-1/3"
            >
              <img
                src={creation.content}
                alt={creation.prompt || 'Generated image'}
                className="w-full h-full object-cover rounded-lg"
                onError={(e) => {
                  console.error('Image failed to load:', creation.content);
                  e.target.style.display = 'none';
                }}
              />

              <div
                className="absolute bottom-0 top-0 right-0 left-3 flex gap-2 items-end
                           justify-end group-hover:justify-between p-3
                           group-hover:bg-gradient-to-b from-transparent to-black/80
                           text-white rounded-lg"
              >
                <p className="text-sm hidden group-hover:block">
                  {creation.prompt}
                </p>

                <div className="flex gap-1 items-center">
                  <p>{creation.likes?.length || 0}</p>
                  <Heart onClick={()=> imageLikeToggle(creation.id)}
                    className={`min-w-5 h-5 hover:scale-110 cursor-pointer ${
                      creation.likes?.includes(user?.id)
                        ? 'fill-red-500 text-red-600'
                        : 'text-white'
                    }`}
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  ) : (
    <div className='flex items-center justify-center h-full'>
      <span className='w-10 h-10 my-1 rounded-full border-3 border-primary border-t-transparent animate-spin'></span>
    </div>
  )
};

export default Community;
